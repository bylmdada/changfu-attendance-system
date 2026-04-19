import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { calculateOvertimePayForRequest, OvertimeType } from '@/lib/salary-utils';
import { getTaiwanYearMonth } from '@/lib/timezone';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getReviewableStatuses() {
  return ['PENDING', 'PENDING_ADMIN'];
}

// POST - 批次審核加班申請
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/overtime-requests/batch-approve');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
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
    const requestedOvertimeType = typeof body.overtimeType === 'string'
      ? body.overtimeType as OvertimeType
      : undefined;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: '無效的審核操作' }, { status: 400 });
    }

    const normalizedIds: number[] = [];
    for (const rawId of ids as Array<number | string>) {
      const idResult = parseIntegerQueryParam(String(rawId), { min: 1, max: 99999999 });
      if (!idResult.isValid || idResult.value === null) {
        return NextResponse.json({ error: 'ids 格式錯誤' }, { status: 400 });
      }
      normalizedIds.push(idResult.value);
    }

    if (action === 'REJECTED') {
      const updateResult = await prisma.overtimeRequest.updateMany({
        where: {
          id: { in: normalizedIds },
          status: { in: getReviewableStatuses() }
        },
        data: {
          status: action,
          approvedBy: user.employeeId,
          approvedAt: new Date(),
        }
      });

      if (updateResult.count === 0) {
        return NextResponse.json({ error: '申請已被處理' }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `已拒絕 ${updateResult.count} 筆加班申請`,
        count: updateResult.count
      });
    }

    const reviewableRequests = await prisma.overtimeRequest.findMany({
      where: {
        id: { in: normalizedIds },
        status: { in: getReviewableStatuses() }
      }
    });

    if (reviewableRequests.length === 0) {
      return NextResponse.json({ error: '申請已被處理' }, { status: 400 });
    }

    let approvedCount = 0;
    const failedIds: number[] = [];
    const errors: string[] = [];

    for (const overtimeRequest of reviewableRequests) {
      const approvedAt = new Date();

      if (overtimeRequest.compensationType === 'COMP_LEAVE') {
        await prisma.$transaction(async (tx) => {
          await tx.overtimeRequest.update({
            where: { id: overtimeRequest.id },
            data: {
              status: 'APPROVED',
              approvedBy: user.employeeId,
              approvedAt,
            }
          });

          await tx.compLeaveTransaction.create({
            data: {
              employeeId: overtimeRequest.employeeId,
              transactionType: 'EARN',
              hours: overtimeRequest.totalHours,
              referenceId: overtimeRequest.id,
              referenceType: 'OVERTIME',
              yearMonth: getTaiwanYearMonth(new Date(overtimeRequest.overtimeDate)),
              description: `加班審核通過 - ${overtimeRequest.reason}`,
              isFrozen: false,
            }
          });

          await tx.compLeaveBalance.upsert({
            where: { employeeId: overtimeRequest.employeeId },
            update: {
              pendingEarn: { increment: overtimeRequest.totalHours }
            },
            create: {
              employeeId: overtimeRequest.employeeId,
              pendingEarn: overtimeRequest.totalHours,
            }
          });
        });

        approvedCount++;
        continue;
      }

      let overtimeType: OvertimeType | undefined;
      let overtimePay: number | undefined;
      let hourlyRateUsed: number | undefined;

      if (overtimeRequest.compensationType === 'OVERTIME_PAY') {
        overtimeType = requestedOvertimeType || 'WEEKDAY';

        const payResult = await calculateOvertimePayForRequest(
          overtimeRequest.employeeId,
          overtimeRequest.overtimeDate,
          overtimeRequest.totalHours,
          overtimeType
        );

        if (payResult.success) {
          overtimePay = payResult.overtimePay ?? undefined;
          hourlyRateUsed = payResult.hourlyRate ?? undefined;
        } else {
          console.error('批次計算加班費失敗:', payResult.error);
          failedIds.push(overtimeRequest.id);
          errors.push(`ID ${overtimeRequest.id}: 加班費計算失敗：${payResult.error || '無法取得員工薪資資料'}`);
          continue;
        }
      }

      await prisma.overtimeRequest.update({
        where: { id: overtimeRequest.id },
        data: {
          status: 'APPROVED',
          approvedBy: user.employeeId,
          approvedAt,
          ...(overtimeType ? { overtimeType } : {}),
          ...(overtimePay !== undefined ? { overtimePay } : {}),
          ...(hourlyRateUsed !== undefined ? { hourlyRateUsed } : {}),
        }
      });

      approvedCount++;
    }

    if (approvedCount === 0) {
      return NextResponse.json(
        {
          error: errors[0] ?? '沒有可審核的申請',
          failedIds,
          errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `批次審核完成：成功 ${approvedCount} 筆，失敗 ${failedIds.length} 筆`,
      count: approvedCount,
      successCount: approvedCount,
      failedCount: failedIds.length,
      failedIds,
      errors,
    });
  } catch (error) {
    console.error('批次審核加班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
