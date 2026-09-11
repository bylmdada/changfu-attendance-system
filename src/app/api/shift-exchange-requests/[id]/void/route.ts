import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { findActiveScheduleFieldsForShift } from '@/lib/shift-definition-service';
import { getPayrollImpactWarning } from '@/lib/payroll-impact-warning';
import { hasClockedAttendance } from '@/lib/shift-exchange-attendance';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SelfChangePayload {
  type?: string;
  original?: string;
}

function parseSelfChangePayload(requestReason: string): SelfChangePayload | null {
  try {
    const parsed = JSON.parse(requestReason) as SelfChangePayload;
    return parsed?.type === 'SELF_CHANGE' ? parsed : null;
  } catch {
    return null;
  }
}

type ShiftExchangeReversalClient = Pick<typeof prisma, 'schedule'>;

async function restoreApprovedShiftExchange(
  tx: ShiftExchangeReversalClient,
  shiftExchangeRequest: {
    requesterId: number;
    targetEmployeeId: number;
    originalWorkDate: string;
    targetWorkDate: string;
    requestReason: string;
    originalShiftType?: string | null;
  }
) {
  const originalShiftType = shiftExchangeRequest.originalShiftType
    ?? parseSelfChangePayload(shiftExchangeRequest.requestReason)?.original;

  if (originalShiftType) {
    const scheduleFields = await findActiveScheduleFieldsForShift(originalShiftType);
    if (!scheduleFields) {
      throw new Error('原班別不存在或已停用，無法還原調班');
    }

    const existingSchedule = await tx.schedule.findFirst({
      where: {
        employeeId: shiftExchangeRequest.requesterId,
        workDate: shiftExchangeRequest.originalWorkDate,
      },
    });

    if (existingSchedule) {
      await tx.schedule.update({
        where: { id: existingSchedule.id },
        data: scheduleFields,
      });
    }

    return;
  }

  throw new Error('員工互調功能已停用，無法作廢舊互調申請');
}

// POST: ADMIN/HR 直接作廢調班申請
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: '請求太頻繁' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (!['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要 HR 或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const requestIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!requestIdResult.isValid || requestIdResult.value === null) {
      return NextResponse.json({ error: '調班申請 ID 格式錯誤' }, { status: 400 });
    }
    const requestId = requestIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的調班作廢資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的調班作廢資料' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫作廢原因' }, { status: 400 });
    }

    const shiftExchangeRequest = await prisma.shiftExchangeRequest.findUnique({
      where: { id: requestId }
    });

    if (!shiftExchangeRequest) {
      return NextResponse.json({ error: '找不到此調班申請' }, { status: 404 });
    }

    if (shiftExchangeRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能作廢已核准的申請' }, { status: 400 });
    }

    if (!shiftExchangeRequest.originalShiftType && !parseSelfChangePayload(shiftExchangeRequest.requestReason)?.original) {
      return NextResponse.json({ error: '調班資料缺少原班別，無法作廢' }, { status: 400 });
    }

    const freezeCheck = await checkAttendanceFreeze(new Date(shiftExchangeRequest.originalWorkDate));
    if (freezeCheck.isFrozen) {
      return NextResponse.json({ error: '該月份已被凍結，無法作廢調班申請' }, { status: 403 });
    }
    if (await hasClockedAttendance(
      prisma,
      shiftExchangeRequest.requesterId,
      shiftExchangeRequest.originalWorkDate
    )) {
      return NextResponse.json({ error: '該日已有打卡紀錄，無法還原調班' }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.shiftExchangeRequest.update({
        where: { id: requestId },
        data: {
          status: 'VOIDED',
          voidedBy: decoded.employeeId,
          voidedAt: new Date(),
          voidReason: reason.trim()
        }
      });

      await restoreApprovedShiftExchange(tx, shiftExchangeRequest);
    });
    await invalidateConfirmation(shiftExchangeRequest.requesterId, shiftExchangeRequest.originalWorkDate.slice(0, 7));
    const warning = await getPayrollImpactWarning(prisma, {
      employeeId: shiftExchangeRequest.requesterId,
      startDate: shiftExchangeRequest.originalWorkDate,
      endDate: shiftExchangeRequest.originalWorkDate,
    });

    return NextResponse.json({
      success: true,
      message: '調班申請已作廢',
      warning,
    });
  } catch (error) {
    console.error('作廢調班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
