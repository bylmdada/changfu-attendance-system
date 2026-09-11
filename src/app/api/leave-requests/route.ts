import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { validateLeaveRequest } from '@/lib/leave-rules-validator';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { getAttendancePermissionDepartments } from '@/lib/attendance-permission-scopes';
import { isAnnualLeaveType, isBereavementLeaveType, splitLeaveReason } from '@/lib/leave-types';
import { calculateLeaveDuration, leaveRangesOverlap } from '@/lib/leave-management-helpers';
import { getLeaveDurationSchedules } from '@/lib/leave-duration-schedules';
import { buildApplicationRequestNumber } from '@/lib/application-request-number';
import { toTaiwanDateStr } from '@/lib/timezone';
import { isValidLeaveDurationMinutes, isValidLeaveMinute } from '@/lib/leave-time-options';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRequiredBereavementReason(leaveType?: string | null, reason?: string | null): boolean {
  if (!isBereavementLeaveType(leaveType)) {
    return true;
  }

  return splitLeaveReason(reason, leaveType).leaveReason.length > 0;
}

function getLeaveYear(value: Date | string): number {
  return new Date(value).getFullYear();
}

function eachDateKey(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const current = new Date(toTaiwanDateStr(start));
  const last = new Date(toTaiwanDateStr(end));

  for (; current <= last; current.setDate(current.getDate() + 1)) {
    keys.push(toTaiwanDateStr(current));
  }

  return keys;
}

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // 建立篩選條件
    const where: {
      employeeId?: number;
      status?: string;
      startDate?: {
        gte?: Date;
        lte?: Date;
      };
      employee?: {
        department?: { in: string[] };
      };
    } = {};
    
    // 權限檢查：決定可以看到哪些請假記錄
    if (user.role === 'ADMIN' || user.role === 'HR') {
      // ADMIN 和 HR 可以看所有記錄
      if (employeeId) {
        const employeeIdResult = parseIntegerQueryParam(employeeId, { min: 1, max: 99999999 });
        if (!employeeIdResult.isValid || employeeIdResult.value === null) {
          return NextResponse.json({ error: 'employeeId 格式錯誤' }, { status: 400 });
        }
        where.employeeId = employeeIdResult.value;
      }
    } else {
      const managedDepartments = await getAttendancePermissionDepartments({
        role: user.role,
        employeeId: user.employeeId,
      }, 'leaveRequests');

      if (managedDepartments.length > 0) {
        where.employee = { department: { in: managedDepartments } };
        
        // 如果有指定 employeeId，額外過濾
        if (employeeId) {
          const employeeIdResult = parseIntegerQueryParam(employeeId, { min: 1, max: 99999999 });
          if (!employeeIdResult.isValid || employeeIdResult.value === null) {
            return NextResponse.json({ error: 'employeeId 格式錯誤' }, { status: 400 });
          }
          where.employeeId = employeeIdResult.value;
        }
      } else {
        // 一般員工只能看到自己的記錄
        where.employeeId = user.employeeId;
      }
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate);
      if (endDate) where.startDate.lte = new Date(endDate);
    }

    const leaveRequests = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        approver: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const annualLeaveKeys = Array.from(
      new Map(
        leaveRequests
          .filter((leaveRequest) => isAnnualLeaveType(leaveRequest.leaveType))
          .map((leaveRequest) => {
            const year = getLeaveYear(leaveRequest.startDate);
            const key = `${leaveRequest.employeeId}:${year}`;
            return [key, { employeeId: leaveRequest.employeeId, year }] as const;
          })
      ).values()
    );

    const annualLeaveBalances = annualLeaveKeys.length > 0
      ? await prisma.annualLeave.findMany({
          where: {
            OR: annualLeaveKeys,
          },
          select: {
            employeeId: true,
            year: true,
            remainingDays: true,
            expiryDate: true,
          },
        })
      : [];

    const annualLeaveBalanceByKey = new Map(
      annualLeaveBalances.map((balance) => [`${balance.employeeId}:${balance.year}`, balance])
    );
    const scheduleKeys = leaveRequests.flatMap((leaveRequest) => (
      eachDateKey(leaveRequest.startDate, leaveRequest.endDate)
        .map((workDate) => ({ employeeId: leaveRequest.employeeId, workDate }))
    ));
    const schedules = scheduleKeys.length > 0
      ? await prisma.schedule.findMany({
          where: {
            OR: scheduleKeys,
          },
          select: {
            employeeId: true,
            workDate: true,
            shiftType: true,
            startTime: true,
            endTime: true,
            breakTime: true,
          },
        })
      : [];
    const schedulesByKey = new Map(
      schedules.map((schedule) => [`${schedule.employeeId}:${schedule.workDate}`, schedule])
    );

    const leaveRequestsWithBalances = leaveRequests.map((leaveRequest) => {
      const requestNumber = buildApplicationRequestNumber('LR', leaveRequest.id, leaveRequest.createdAt);
      const leaveSchedules = eachDateKey(leaveRequest.startDate, leaveRequest.endDate)
        .map((workDate) => schedulesByKey.get(`${leaveRequest.employeeId}:${workDate}`))
        .filter((schedule): schedule is NonNullable<typeof schedule> => Boolean(schedule));

      if (!isAnnualLeaveType(leaveRequest.leaveType)) {
        return { ...leaveRequest, requestNumber, leaveSchedules, annualLeaveBalance: null };
      }

      const year = getLeaveYear(leaveRequest.startDate);
      const balance = annualLeaveBalanceByKey.get(`${leaveRequest.employeeId}:${year}`);

      return {
        ...leaveRequest,
        requestNumber,
        leaveSchedules,
        annualLeaveBalance: balance
          ? {
              year: balance.year,
              remainingDays: balance.remainingDays,
              expiryDate: balance.expiryDate,
            }
          : null,
      };
    });

    return NextResponse.json({ leaveRequests: leaveRequestsWithBalances });
  } catch (error) {
    console.error('獲取請假記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的請假申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的請假申請資料' }, { status: 400 });
    }

    const { leaveType, startDate, endDate, reason } = body as { leaveType?: string; startDate?: string; endDate?: string; reason?: string };

    // 可選的時間欄位（小時/分鐘）
    const { startHour, startMinute, endHour, endMinute } = body as { startHour?: string; startMinute?: string; endHour?: string; endMinute?: string };

    // 驗證必填欄位
    if (!leaveType || !startDate || !endDate) {
      return NextResponse.json({ error: '請假類型、開始日期和結束日期為必填' }, { status: 400 });
    }

    if (!hasRequiredBereavementReason(leaveType, reason)) {
      return NextResponse.json({ error: '喪假申請原因需選擇法定亡故親屬關係' }, { status: 400 });
    }

    // 檢查凍結狀態
    const startDateObj = new Date(startDate);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _endDateObj = new Date(endDate);
    const freezeCheck = await checkAttendanceFreeze(startDateObj);

    if (freezeCheck.isFrozen) {
      const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
      return NextResponse.json({
        error: `該月份已被凍結，無法提交請假申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
      }, { status: 403 });
    }

    let start: Date;
    let end: Date;

    // 若前端提供時間欄位，則以時間欄位為準並嚴格套用 5 分鐘規則
    if (startHour !== undefined && startMinute !== undefined && endHour !== undefined && endMinute !== undefined) {
      const sM = String(startMinute).padStart(2, '0');
      const eM = String(endMinute).padStart(2, '0');

      if (!isValidLeaveMinute(sM) || !isValidLeaveMinute(eM)) {
        return NextResponse.json({ error: '起訖時間的分鐘僅允許 0 至 55 分，並以 5 分鐘為增量' }, { status: 400 });
      }

      const sH = String(startHour).padStart(2, '0');
      const eH = String(endHour).padStart(2, '0');

      // 建立包含時間的 DateTime
      start = new Date(`${startDate}T${sH}:${sM}:00`);
      end = new Date(`${endDate}T${eH}:${eM}:00`);

      const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
      if (diffMin <= 0) {
        return NextResponse.json({ error: '請假時數必須為正數' }, { status: 400 });
      }
      if (!isValidLeaveDurationMinutes(diffMin)) {
        return NextResponse.json({ error: '請假時數需以 5 分鐘為增量' }, { status: 400 });
      }

      const schedulesByDate = await getLeaveDurationSchedules(user.employeeId, startDate, endDate);
      const duration = calculateLeaveDuration({
        startDate,
        endDate,
        startHour: sH,
        startMinute: sM,
        endHour: eH,
        endMinute: eM,
      }, schedulesByDate);

      if (!duration) {
        return NextResponse.json({ error: '請假時數必須落在有效排班時段內' }, { status: 400 });
      }

      const totalDays = duration.totalDays;

      // 檢查是否有重複的請假申請（以精確時間重疊判斷）
      const activeLeaves = await prisma.leaveRequest.findMany({
        where: {
          employeeId: user.employeeId,
          status: { in: ['PENDING', 'PENDING_ADMIN', 'APPROVED'] },
          startDate: { lt: end },
          endDate: { gt: start },
        }
      });

      if (activeLeaves.some((leave) => leaveRangesOverlap(start, end, leave.startDate, leave.endDate))) {
        return NextResponse.json({ error: '該時間段已有請假申請' }, { status: 400 });
      }

      // 驗證假別規則
      const leaveValidation = await validateLeaveRequest(
        user.employeeId,
        leaveType,
        totalDays,
        start.getFullYear()
      );

      if (!leaveValidation.valid) {
        return NextResponse.json({ error: leaveValidation.error }, { status: 400 });
      }

      const leaveRequest = await prisma.leaveRequest.create({
        data: {
          employeeId: user.employeeId,
          leaveType,
          startDate: start,
          endDate: end,
          totalDays,
          reason: reason || null
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              department: true,
              position: true
            }
          }
        }
      });

      // 建立審核實例
      await createApprovalForRequest({
        requestType: 'LEAVE',
        requestId: leaveRequest.id,
        applicantId: leaveRequest.employee.id,
        applicantName: leaveRequest.employee.name,
        department: leaveRequest.employee.department
      });

      return NextResponse.json({ 
        success: true, 
        leaveRequest,
        message: '請假申請提交成功' 
      });
    }

    // 未提供時間欄位：沿用原日為單位邏輯
    start = new Date(startDate);
    end = new Date(endDate);
    const timeDiff = end.getTime() - start.getTime();
    const totalDays = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;

    if (totalDays <= 0) {
      return NextResponse.json({ error: '結束日期必須晚於或等於開始日期' }, { status: 400 });
    }

    // 檢查是否有重複的請假申請（日期重疊）
    const activeLeaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId: user.employeeId,
        status: { in: ['PENDING', 'PENDING_ADMIN', 'APPROVED'] },
        startDate: { lt: end },
        endDate: { gt: start },
      }
    });

    if (activeLeaves.some((leave) => leaveRangesOverlap(start, end, leave.startDate, leave.endDate))) {
      return NextResponse.json({ error: '該時間段已有請假申請' }, { status: 400 });
    }

    // 驗證假別規則
    const leaveValidation = await validateLeaveRequest(
      user.employeeId,
      leaveType,
      totalDays,
      start.getFullYear()
    );

    if (!leaveValidation.valid) {
      return NextResponse.json({ error: leaveValidation.error }, { status: 400 });
    }

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId: user.employeeId,
        leaveType,
        startDate: start,
        endDate: end,
        totalDays,
        reason: reason || null
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      }
    });

    // 建立審核實例
    await createApprovalForRequest({
      requestType: 'LEAVE',
      requestId: leaveRequest.id,
      applicantId: leaveRequest.employee.id,
      applicantName: leaveRequest.employee.name,
      department: leaveRequest.employee.department
    });

    return NextResponse.json({ 
      success: true, 
      leaveRequest,
      message: '請假申請提交成功' 
    });
  } catch (error) {
    console.error('提交請假申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
