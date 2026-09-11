import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { reverseCompensatoryLeaveUse } from '@/lib/compensatory-leave-accounting';
import { getPayrollImpactWarning } from '@/lib/payroll-impact-warning';
import { reverseApprovedAnnualLeaveAccounting } from '@/lib/annual-leave-schedule-accounting';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// POST: ADMIN/HR 直接作廢請假申請
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
    const leaveIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!leaveIdResult.isValid || leaveIdResult.value === null) {
      return NextResponse.json({ error: '請假申請 ID 格式錯誤' }, { status: 400 });
    }
    const leaveId = leaveIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的請假作廢資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的請假作廢資料' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫作廢原因' }, { status: 400 });
    }

    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: leaveId }
    });

    if (!leaveRequest) {
      return NextResponse.json({ error: '找不到此請假申請' }, { status: 404 });
    }

    // 檢查狀態是否為已核准
    if (leaveRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能作廢已核准的申請' }, { status: 400 });
    }

    const freezeCheck = await checkAttendanceFreeze(new Date(leaveRequest.startDate));
    if (freezeCheck.isFrozen) {
      return NextResponse.json({ error: '該月份已被凍結，無法作廢請假申請' }, { status: 403 });
    }

    // 直接作廢
    await prisma.$transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id: leaveId, status: 'APPROVED' },
        data: {
          status: 'VOIDED',
          voidedBy: user.employeeId,
          voidedAt: new Date(),
          voidReason: reason.trim()
        }
      });

    await reverseApprovedAnnualLeaveAccounting(tx, leaveRequest);

    await reverseCompensatoryLeaveUse(tx, leaveRequest, 'LEAVE_VOID');
    });
    const warning = await getPayrollImpactWarning(prisma, leaveRequest);

    return NextResponse.json({
      success: true,
      message: '請假申請已作廢',
      warning,
    });
  } catch (error) {
    console.error('作廢請假申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
