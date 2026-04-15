import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getTaiwanYearMonth } from '@/lib/timezone';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 回沖補休時數
async function reverseCompLeave(
  tx: Pick<typeof prisma, 'compLeaveBalance' | 'compLeaveTransaction'>,
  employeeId: number,
  hours: number,
  overtimeRequestId: number
) {
  const balance = await tx.compLeaveBalance.findUnique({
    where: { employeeId }
  });

  if (!balance) {
    console.log(`員工 ${employeeId} 沒有補休餘額記錄`);
    return false;
  }

  await tx.compLeaveBalance.update({
    where: { employeeId },
    data: {
      totalEarned: { decrement: hours },
      balance: { decrement: hours }
    }
  });

  const yearMonth = getTaiwanYearMonth();
  
  await tx.compLeaveTransaction.create({
    data: {
      employeeId,
      transactionType: 'ADJUST',
      hours: -hours,
      isFrozen: true,
      referenceType: 'OVERTIME_VOID',
      referenceId: overtimeRequestId,
      description: `加班作廢回沖 (加班申請 #${overtimeRequestId})`,
      yearMonth
    }
  });

  return true;
}

// POST: ADMIN/HR 直接作廢加班申請
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

    const user = await getUserFromRequest(request);
    if (!user || !['ADMIN', 'HR'].includes(user.role)) {
      return NextResponse.json({ error: '需要 HR 或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const overtimeIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!overtimeIdResult.isValid || overtimeIdResult.value === null) {
      return NextResponse.json({ error: '加班申請 ID 格式錯誤' }, { status: 400 });
    }
    const overtimeId = overtimeIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的加班作廢資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的加班作廢資料' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫作廢原因' }, { status: 400 });
    }

    const overtimeRequest = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeId }
    });

    if (!overtimeRequest) {
      return NextResponse.json({ error: '找不到此加班申請' }, { status: 404 });
    }

    if (overtimeRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能作廢已核准的申請' }, { status: 400 });
    }

    const compLeaveReversed = await prisma.$transaction(async (tx) => {
      const reversed = overtimeRequest.compensationType === 'COMP_LEAVE'
        ? await reverseCompLeave(
            tx,
            overtimeRequest.employeeId,
            overtimeRequest.totalHours,
            overtimeId
          )
        : false;

      await tx.overtimeRequest.update({
        where: { id: overtimeId },
        data: {
          status: 'VOIDED',
          voidedBy: user.employeeId,
          voidedAt: new Date(),
          voidReason: reason.trim(),
          compLeaveReversed: reversed,
          compLeaveReversedAt: reversed ? new Date() : null
        }
      });

      return reversed;
    });

    return NextResponse.json({
      success: true,
      message: compLeaveReversed 
        ? '加班申請已作廢，補休已回沖' 
        : '加班申請已作廢'
    });
  } catch (error) {
    console.error('作廢加班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
