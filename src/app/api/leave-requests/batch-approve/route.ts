import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { getAnnualLeaveYearBreakdown } from '@/lib/annual-leave';
import { isAnnualLeaveType } from '@/lib/leave-types';

interface PrismaWithSchedule {
  schedule?: {
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReviewableStatus(status?: string | null) {
  return status === 'PENDING' || status === 'PENDING_ADMIN';
}

function toYmd(d: Date) {
  const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const yyyy = tw.getFullYear();
  const mm = String(tw.getMonth() + 1).padStart(2, '0');
  const dd = String(tw.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
          where: { id: leaveRequestId },
          data: {
            status: action,
            approvedBy: user.employeeId,
            approvedAt: new Date(),
            ...(remarks && { rejectReason: action === 'REJECTED' ? remarks : null })
          }
        });

        if (action === 'APPROVED' && isAnnualLeaveType(leaveRequest.leaveType)) {
          const startDate = new Date(leaveRequest.startDate);
          const endDate = new Date(leaveRequest.endDate);
          for (const { year, days } of getAnnualLeaveYearBreakdown(startDate, endDate)) {
            await tx.annualLeave.updateMany({
              where: {
                employeeId: leaveRequest.employeeId,
                year,
              },
              data: {
                usedDays: { increment: days },
                remainingDays: { decrement: days },
              },
            });
          }
        }

        const txWithSchedule = tx as unknown as PrismaWithSchedule;

        if (action === 'APPROVED' && txWithSchedule.schedule) {
          const startDate = new Date(leaveRequest.startDate);
          const endDate = new Date(leaveRequest.endDate);
          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            await txWithSchedule.schedule.updateMany({
              where: {
                employeeId: leaveRequest.employeeId,
                workDate: toYmd(d),
              },
              data: {
                shiftType: 'FDL',
                startTime: '',
                endTime: '',
              },
            });
          }
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
