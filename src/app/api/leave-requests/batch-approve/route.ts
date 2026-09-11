import { applyApprovedLeaveAccounting } from '@/lib/annual-leave-schedule-accounting';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReviewableStatus(status?: string | null) {
  return status === 'PENDING' || status === 'PENDING_ADMIN';
}

// POST - 批次審核請假申請
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請選擇要審核的申請' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    const ids = Array.isArray(body.ids) ? body.ids : undefined;
    const action = typeof body.action === 'string' ? body.action : undefined;
    const remarks = typeof body.remarks === 'string' ? body.remarks : undefined;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: '無效的審核操作' }, { status: 400 });
    }

    let approvedCount = 0;

    for (const rawId of ids) {
      const leaveRequestId = parseInt(String(rawId), 10);
      if (!Number.isInteger(leaveRequestId) || leaveRequestId <= 0) {
        continue;
      }

      const leaveRequest = await prisma.leaveRequest.findUnique({
        where: { id: leaveRequestId },
        include: { employee: true },
      });

      if (!leaveRequest || !isReviewableStatus(leaveRequest.status)) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.leaveRequest.update({
          where: { id: leaveRequestId, status: leaveRequest.status },
          data: {
            status: action,
            approvedBy: user.employeeId,
            approvedAt: new Date(),
            ...(remarks && { rejectReason: action === 'REJECTED' ? remarks : null })
          }
        });

        if (action === 'APPROVED') {
          await applyApprovedLeaveAccounting(tx, leaveRequest);
        }

      });

      approvedCount++;
    }

    if (approvedCount === 0) {
      return NextResponse.json({ error: '申請已被處理' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `已${action === 'APPROVED' ? '批准' : '拒絕'} ${approvedCount} 筆請假申請`,
      count: approvedCount
    });
  } catch (error) {
    console.error('批次審核請假申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
