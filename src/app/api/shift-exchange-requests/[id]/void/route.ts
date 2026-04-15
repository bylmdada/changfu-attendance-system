import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SelfChangePayload {
  type?: string;
  original?: string;
}

type ShiftExchangeReversalClient = Pick<typeof prisma, 'schedule'>;

function getTemplateByShift(shift: string): { startTime: string; endTime: string } {
  const map: Record<string, { startTime: string; endTime: string }> = {
    A: { startTime: '07:30', endTime: '16:30' },
    B: { startTime: '08:00', endTime: '17:00' },
    C: { startTime: '08:30', endTime: '17:30' },
  };

  return map[shift] || { startTime: '', endTime: '' };
}

async function restoreApprovedShiftExchange(
  tx: ShiftExchangeReversalClient,
  shiftExchangeRequest: {
    requesterId: number;
    targetEmployeeId: number;
    originalWorkDate: string;
    targetWorkDate: string;
    requestReason: string;
  }
) {
  let parsed: SelfChangePayload | null = null;
  try {
    parsed = JSON.parse(shiftExchangeRequest.requestReason) as SelfChangePayload;
  } catch {}

  const isSelfChange = parsed?.type === 'SELF_CHANGE';

  if (isSelfChange) {
    const originalShift = parsed?.original ?? 'A';
    const template = getTemplateByShift(originalShift);
    const existingSchedule = await tx.schedule.findFirst({
      where: {
        employeeId: shiftExchangeRequest.requesterId,
        workDate: shiftExchangeRequest.originalWorkDate,
      },
    });

    if (existingSchedule) {
      await tx.schedule.update({
        where: { id: existingSchedule.id },
        data: {
          shiftType: originalShift,
          startTime: template.startTime,
          endTime: template.endTime,
        },
      });
    }

    return;
  }

  const [requesterSchedule, targetSchedule] = await Promise.all([
    tx.schedule.findFirst({
      where: {
        employeeId: shiftExchangeRequest.requesterId,
        workDate: shiftExchangeRequest.originalWorkDate,
      },
    }),
    tx.schedule.findFirst({
      where: {
        employeeId: shiftExchangeRequest.targetEmployeeId,
        workDate: shiftExchangeRequest.targetWorkDate,
      },
    }),
  ]);

  if (requesterSchedule && targetSchedule) {
    const requesterOriginal = {
      shiftType: requesterSchedule.shiftType,
      startTime: requesterSchedule.startTime,
      endTime: requesterSchedule.endTime,
    };

    await tx.schedule.update({
      where: { id: requesterSchedule.id },
      data: {
        shiftType: targetSchedule.shiftType,
        startTime: targetSchedule.startTime,
        endTime: targetSchedule.endTime,
      },
    });

    await tx.schedule.update({
      where: { id: targetSchedule.id },
      data: requesterOriginal,
    });
  }
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

    return NextResponse.json({
      success: true,
      message: '調班申請已作廢'
    });
  } catch (error) {
    console.error('作廢調班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
