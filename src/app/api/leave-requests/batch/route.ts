import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { getAnnualLeaveYearBreakdown } from '@/lib/annual-leave';

interface PrismaWithSchedule {
  schedule?: {
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toYmd(d: Date) {
  const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const yyyy = tw.getFullYear();
  const mm = String(tw.getMonth() + 1).padStart(2, '0');
  const dd = String(tw.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * POST - 批量審核請假申請
 */
export async function POST(request: NextRequest) {
  try {
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有 ADMIN 和 HR 可以批量審核
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的批次審核資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的批次審核資料' }, { status: 400 });
    }

    const ids = Array.isArray(body.ids) ? body.ids : undefined;
    const action = typeof body.action === 'string' ? body.action : undefined;
    const rejectReason = typeof body.remarks === 'string'
      ? body.remarks
      : typeof body.reason === 'string'
        ? body.reason
        : undefined;

    // 驗證參數
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: '無效的審核動作' }, { status: 400 });
    }

    const parsedIds = ids.map((id) => {
      const normalizedId = typeof id === 'string' || typeof id === 'number' ? String(id) : null;
      return parseIntegerQueryParam(normalizedId, { min: 1, max: 99999999 });
    });

    if (parsedIds.some((result) => !result.isValid || result.value === null)) {
      return NextResponse.json({ error: '請提供有效的申請 ID 清單' }, { status: 400 });
    }

    const leaveRequestIds = parsedIds.map((result) => result.value as number);

    const results = {
      successCount: 0,
      failedCount: 0,
      failedIds: [] as number[],
      errors: [] as string[]
    };

    // 批量處理
    for (const leaveRequestId of leaveRequestIds) {
      try {
        // 檢查申請是否存在且為待審核狀態
        const leaveRequest = await prisma.leaveRequest.findUnique({
          where: { id: leaveRequestId },
          include: { employee: true }
        });

        if (!leaveRequest) {
          results.failedIds.push(leaveRequestId);
          results.errors.push(`ID ${leaveRequestId}: 申請不存在`);
          results.failedCount++;
          continue;
        }

        if (leaveRequest.status !== 'PENDING' && leaveRequest.status !== 'PENDING_ADMIN') {
          results.failedIds.push(leaveRequestId);
          results.errors.push(`ID ${leaveRequestId}: 申請已被處理`);
          results.failedCount++;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.leaveRequest.update({
            where: { id: leaveRequestId },
            data: {
              status: action,
              approvedBy: user.employeeId,
              approvedAt: new Date(),
              ...(action === 'REJECTED' && rejectReason ? { rejectReason } : {})
            }
          });

          if (action === 'APPROVED' && leaveRequest.leaveType === 'ANNUAL_LEAVE') {
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
                }
              });
            }

            const txWithSchedule = tx as unknown as PrismaWithSchedule;
            if (txWithSchedule.schedule) {
              for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                await txWithSchedule.schedule.updateMany({
                  where: {
                    employeeId: leaveRequest.employeeId,
                    workDate: toYmd(d)
                  },
                  data: {
                    shiftType: 'FDL',
                    startTime: '',
                    endTime: ''
                  }
                });
              }
            }
          }
        });

        results.successCount++;
      } catch (error) {
        console.error(`處理 ID ${leaveRequestId} 失敗:`, error);
        results.failedIds.push(leaveRequestId);
        results.errors.push(`ID ${leaveRequestId}: 處理失敗`);
        results.failedCount++;
      }
    }

    if (results.successCount === 0) {
      const allAlreadyProcessed =
        results.failedCount > 0 &&
        results.errors.every((error) => error.endsWith('申請已被處理'));

      return NextResponse.json(
        {
          error: allAlreadyProcessed ? '申請已被處理' : results.errors[0] ?? '沒有可審核的申請',
          failedIds: results.failedIds,
          errors: results.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `批量審核完成：成功 ${results.successCount} 筆，失敗 ${results.failedCount} 筆`,
      ...results
    });
  } catch (error) {
    console.error('批量審核請假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
