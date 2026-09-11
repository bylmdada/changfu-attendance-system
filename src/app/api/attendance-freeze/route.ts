import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { AuditAction, AuditTargetType, getRequestInfo, logAudit } from '@/lib/audit';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStrictInteger(
  value: unknown,
  { min, max }: { min: number; max: number }
) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < min || value > max) {
      return { value: null, isValid: false };
    }

    return { value, isValid: true };
  }

  if (typeof value !== 'string') {
    return { value: null, isValid: false };
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return { value: null, isValid: false };
  }

  const parsed = Number(trimmedValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { value: null, isValid: false };
  }

  return { value: parsed, isValid: true };
}

function parseFreezeDateValue(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { value: null, isValid: false };
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return { value: null, isValid: false };
  }

  return { value: parsedDate, isValid: true };
}

export async function GET(request: NextRequest) {
  try {
    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const freezes = await prisma.attendanceFreeze.findMany({
      include: {
        creator: {
          select: {
            id: true,
            employeeId: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const now = new Date();
    return NextResponse.json({
      freezes: freezes.map((freeze) => ({
        ...freeze,
        status: !freeze.isActive
          ? 'DISABLED'
          : now >= freeze.freezeDate
            ? 'ACTIVE'
            : 'SCHEDULED',
      })),
    });
  } catch (error) {
    console.error('獲取凍結設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的凍結設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的凍結設定資料' }, { status: 400 });
    }

    const { freezeDate, targetMonth, targetYear, description } = body;

    if (!freezeDate || !targetMonth || !targetYear) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const targetMonthResult = parseStrictInteger(targetMonth, { min: 1, max: 12 });
    const targetYearResult = parseStrictInteger(targetYear, { min: 2000, max: 2100 });
    if (!targetMonthResult.isValid || !targetYearResult.isValid || targetMonthResult.value === null || targetYearResult.value === null) {
      return NextResponse.json({ error: '目標月份或年份格式不正確' }, { status: 400 });
    }

    const freezeDateResult = parseFreezeDateValue(freezeDate);
    if (!freezeDateResult.isValid || freezeDateResult.value === null) {
      return NextResponse.json({ error: '凍結日期格式不正確' }, { status: 400 });
    }

    const targetMonthValue = targetMonthResult.value;
    const targetYearValue = targetYearResult.value;
    const freezeDateValue = freezeDateResult.value;
    const descriptionValue = typeof description === 'string' ? description.trim() || null : null;

    if (!decoded.employeeId) {
      return NextResponse.json({ error: '當前帳號缺少員工資料，無法建立凍結設定' }, { status: 400 });
    }

    // 檢查是否已經存在相同的凍結設定
    const existingFreeze = await prisma.attendanceFreeze.findFirst({
      where: {
        targetMonth: targetMonthValue,
        targetYear: targetYearValue,
        isActive: true
      }
    });

    if (existingFreeze) {
      return NextResponse.json({ error: '該月份已經被凍結' }, { status: 400 });
    }

    const freeze = await prisma.attendanceFreeze.create({
      data: {
        freezeDate: freezeDateValue,
        targetMonth: targetMonthValue,
        targetYear: targetYearValue,
        description: descriptionValue,
        createdBy: decoded.employeeId
      },
      include: {
        creator: {
          select: {
            id: true,
            employeeId: true,
            name: true
          }
        }
      }
    });

    const { ip, userAgent } = getRequestInfo(request);
    await logAudit({
      userId: decoded.userId,
      employeeId: decoded.employeeId,
      action: AuditAction.ATTENDANCE_FREEZE,
      targetType: AuditTargetType.ATTENDANCE_FREEZE,
      targetId: freeze.id,
      newValue: {
        targetYear: targetYearValue,
        targetMonth: targetMonthValue,
        freezeDate: freezeDateValue.toISOString(),
        description: descriptionValue,
      },
      description: '建立考勤凍結設定',
      ipAddress: ip,
      userAgent,
    });

    const payrollMessage = `已凍結 ${targetYearValue}年${targetMonthValue}月考勤。請前往薪資管理頁面執行薪資結算。`;

    return NextResponse.json({ 
      freeze,
      message: payrollMessage,
    });
  } catch (error) {
    console.error('創建凍結設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const decoded = await getUserFromRequest(request);
    if (!decoded) return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    if (decoded.role !== 'ADMIN') return NextResponse.json({ error: '權限不足' }, { status: 403 });

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success || !isPlainObject(parseResult.data)) {
      return NextResponse.json({ error: '請提供有效的凍結狀態資料' }, { status: 400 });
    }

    const body = parseResult.data;
    const idResult = parseStrictInteger(body.id, { min: 1, max: 99999999 });
    const isActive = body.isActive;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!idResult.isValid || idResult.value === null || typeof isActive !== 'boolean' || !reason) {
      return NextResponse.json({ error: '凍結 ID、狀態與原因均為必填' }, { status: 400 });
    }

    const existing = await prisma.attendanceFreeze.findUnique({ where: { id: idResult.value } });
    if (!existing) return NextResponse.json({ error: '找不到凍結設定' }, { status: 404 });

    if (isActive) {
      const activeFreeze = await prisma.attendanceFreeze.findFirst({
        where: {
          targetMonth: existing.targetMonth,
          targetYear: existing.targetYear,
          isActive: true,
          id: { not: existing.id },
        },
      });
      if (activeFreeze) return NextResponse.json({ error: '該月份已有其他生效中的凍結設定' }, { status: 409 });
    }

    const freeze = await prisma.attendanceFreeze.update({
      where: { id: existing.id },
      data: { isActive },
      include: {
        creator: { select: { id: true, employeeId: true, name: true } },
      },
    });
    const { ip, userAgent } = getRequestInfo(request);
    await logAudit({
      userId: decoded.userId,
      employeeId: decoded.employeeId,
      action: AuditAction.ATTENDANCE_FREEZE,
      targetType: AuditTargetType.ATTENDANCE_FREEZE,
      targetId: existing.id,
      oldValue: { isActive: existing.isActive },
      newValue: { isActive, reason },
      description: isActive ? '重新啟用考勤凍結設定' : '停用考勤凍結設定',
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({ success: true, freeze });
  } catch (error) {
    console.error('更新凍結狀態失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
