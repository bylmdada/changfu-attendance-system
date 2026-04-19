import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, verifyPassword } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { checkClockRateLimit, clearFailedAttempts, recordFailedClockAttempt } from '@/lib/rate-limit';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function calculateLinkedOvertimeHours(startTime: unknown, endTime: unknown): number | null {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }

  const totalHours = (endMinutes - startMinutes) / 60;
  return Math.ceil(totalHours * 2) / 2;
}

// POST - 提交打卡原因
export async function POST(request: NextRequest) {
  try {
    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '缺少必要參數' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const recordId = isPlainObject(body) && typeof body.recordId === 'number' ? body.recordId : undefined;
    const clockType = isPlainObject(body) && typeof body.clockType === 'string' ? body.clockType : undefined;
    const reason = isPlainObject(body) && typeof body.reason === 'string' ? body.reason : undefined;
    const overtimeId = isPlainObject(body) && typeof body.overtimeId === 'number' ? body.overtimeId : undefined;
    const newOvertimeRequest = isPlainObject(body) ? body.newOvertimeRequest : undefined;
    const username = isPlainObject(body) && typeof body.username === 'string' ? body.username : '';
    const password = isPlainObject(body) && typeof body.password === 'string' ? body.password : '';

    if (!recordId || !clockType || !reason) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (!['in', 'out'].includes(clockType)) {
      return NextResponse.json({ error: '無效的打卡類型' }, { status: 400 });
    }

    if (!['PERSONAL', 'BUSINESS'].includes(reason)) {
      return NextResponse.json({ error: '無效的原因類型' }, { status: 400 });
    }

    const sessionUser = await getUserFromRequest(request);
    if (sessionUser) {
      const csrfValidation = await validateCSRF(request);
      if (!csrfValidation.valid) {
        return NextResponse.json(
          { error: csrfValidation.error || 'CSRF token validation failed' },
          { status: 403 }
        );
      }
    }

    // 查詢考勤記錄
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { employee: true }
    });

    if (!record) {
      return NextResponse.json({ error: '考勤記錄不存在' }, { status: 404 });
    }

    let isAuthorized = false;

    if (sessionUser) {
      const employeeUserId = await prisma.user.findFirst({
        where: { employeeId: record.employeeId },
        select: { id: true }
      });

      if (
        employeeUserId?.id === sessionUser.userId ||
        sessionUser.role === 'ADMIN' ||
        sessionUser.role === 'HR'
      ) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized && username && password) {
      const rateLimitResult = await checkClockRateLimit(request, username);
      if (!rateLimitResult.allowed) {
        return NextResponse.json(
          { error: rateLimitResult.reason || '請求過於頻繁' },
          {
            status: 429,
            headers: { 'Retry-After': String(rateLimitResult.retryAfter || 60) }
          }
        );
      }

      const quickAuthUser = await prisma.user.findUnique({
        where: { username },
        include: { employee: true }
      });

      if (!quickAuthUser) {
        await recordFailedClockAttempt(username);
      } else if (!quickAuthUser.isActive) {
        await recordFailedClockAttempt(username);
        return NextResponse.json({ error: '帳號已停用，請聯繫管理員' }, { status: 401 });
      } else if (!quickAuthUser.employee) {
        await recordFailedClockAttempt(username);
      } else {
        const isPasswordValid = await verifyPassword(password, quickAuthUser.passwordHash);
        if (isPasswordValid && quickAuthUser.employee.id === record.employeeId) {
          isAuthorized = true;
          await clearFailedAttempts(username);
        } else {
          await recordFailedClockAttempt(username);
        }
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: '無權限修改此記錄' }, { status: 403 });
    }

    let linkedOvertimeId = overtimeId;

    // 如果選擇公務且需要快速申請加班
    if (reason === 'BUSINESS' && newOvertimeRequest) {
      const startTime = isPlainObject(newOvertimeRequest) && typeof newOvertimeRequest.startTime === 'string'
        ? newOvertimeRequest.startTime
        : undefined;
      const endTime = isPlainObject(newOvertimeRequest) && typeof newOvertimeRequest.endTime === 'string'
        ? newOvertimeRequest.endTime
        : undefined;
      const overtimeReason = isPlainObject(newOvertimeRequest) && typeof newOvertimeRequest.overtimeReason === 'string'
        ? newOvertimeRequest.overtimeReason
        : undefined;
      const calculatedHours = calculateLinkedOvertimeHours(startTime, endTime);

      if (calculatedHours === null) {
        return NextResponse.json({ error: '加班時間格式無效' }, { status: 400 });
      }

      if (calculatedHours < 0.5) {
        return NextResponse.json({ error: '加班時數最少0.5小時' }, { status: 400 });
      }

      if (calculatedHours > 4) {
        return NextResponse.json({ error: '單日加班時數不能超過4小時' }, { status: 400 });
      }

      if (!startTime || !endTime) {
        return NextResponse.json({ error: '加班時間格式無效' }, { status: 400 });
      }
      
      // 建立加班申請
      const newOvertime = await prisma.overtimeRequest.create({
        data: {
          employeeId: record.employeeId,
          overtimeDate: record.workDate,
          startTime: startTime, // String format "HH:mm"
          endTime: endTime,     // String format "HH:mm"
          totalHours: calculatedHours,
          reason: overtimeReason || (clockType === 'in' ? '提早上班工作' : '延後下班工作'),
          status: 'PENDING'
        }
      });

      linkedOvertimeId = newOvertime.id;
    }

    // 更新考勤記錄
    const updateData: Record<string, unknown> = {};
    if (clockType === 'in') {
      updateData.clockInReason = reason;
      if (linkedOvertimeId) updateData.clockInOvertimeId = linkedOvertimeId;
    } else {
      updateData.clockOutReason = reason;
      if (linkedOvertimeId) updateData.clockOutOvertimeId = linkedOvertimeId;
    }

    await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: updateData
    });

    return NextResponse.json({ 
      success: true, 
      message: reason === 'BUSINESS' ? '已記錄為公務' : '已記錄為非公務',
      overtimeId: linkedOvertimeId
    });
  } catch (error) {
    console.error('提交打卡原因失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
