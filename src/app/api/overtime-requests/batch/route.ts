import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { calculateOvertimePayForRequest, OvertimeType } from '@/lib/salary-utils';
import { getTaiwanYearMonth } from '@/lib/timezone';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import {
  calculateOvertimeRequestEligibility,
  getOvertimeEligibilityError,
} from '@/lib/overtime-eligibility';
import { isReviewerFor } from '@/lib/approval-service';
import { getApprovalWorkflow } from '@/lib/approval-workflow';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * POST - 批量審核加班申請
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/overtime-requests/batch');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const isFinalReviewer = user.role === 'ADMIN' || user.role === 'HR';

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
    const reviewNote = [body.notes, body.remarks, body.reason]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim();

    // 驗證參數
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: '無效的審核動作' }, { status: 400 });
    }

    const normalizedIds: number[] = [];
    for (const rawId of ids as Array<number | string>) {
      const idResult = parseIntegerQueryParam(String(rawId), { min: 1, max: 99999999 });
      if (!idResult.isValid || idResult.value === null) {
        return NextResponse.json({ error: 'ids 格式錯誤' }, { status: 400 });
      }
      normalizedIds.push(idResult.value);
    }

    const results = {
      successCount: 0,
      failedCount: 0,
      failedIds: [] as number[],
      errors: [] as string[]
    };

    // 批量處理
    for (const id of normalizedIds) {
      try {
        let managerFinalReviewData: {
          managerReviewerId: number;
          managerOpinion: 'AGREE' | 'DISAGREE';
          managerNote: string | null;
          managerReviewedAt: Date;
        } | null = null;
        // 檢查申請是否存在且為待審核狀態
        const overtimeRequest = await prisma.overtimeRequest.findUnique({
          where: { id },
          include: { employee: true }
        });

        if (!overtimeRequest) {
          results.failedIds.push(id);
          results.errors.push(`ID ${id}: 申請不存在`);
          results.failedCount++;
          continue;
        }

        const isReviewable = isFinalReviewer
          ? overtimeRequest.status === 'PENDING' || overtimeRequest.status === 'PENDING_ADMIN'
          : overtimeRequest.status === 'PENDING';
        if (!isReviewable) {
          results.failedIds.push(id);
          results.errors.push(`ID ${id}: 申請已被處理`);
          results.failedCount++;
          continue;
        }

        if (!isFinalReviewer) {
          const department = overtimeRequest.employee?.department;
          const reviewPermission = user.employeeId && department
            ? await isReviewerFor(user.employeeId, department, 'OVERTIME')
            : { isReviewer: false };

          if (!reviewPermission.isReviewer || !user.employeeId) {
            results.failedIds.push(id);
            results.errors.push(`ID ${id}: 無權限審核此部門的加班申請`);
            results.failedCount++;
            continue;
          }

          const reviewedAt = new Date();
          managerFinalReviewData = {
            managerReviewerId: user.employeeId,
            managerOpinion: action === 'APPROVED' ? 'AGREE' : 'DISAGREE',
            managerNote: reviewNote || null,
            managerReviewedAt: reviewedAt,
          };
          const workflow = await getApprovalWorkflow('OVERTIME', { department });

          if ((workflow?.approvalLevel ?? 2) > 1) {
            await prisma.overtimeRequest.update({
              where: { id },
              data: {
                status: 'PENDING_ADMIN',
                ...managerFinalReviewData,
              },
            });
            results.successCount++;
            continue;
          }
        }

        if (!managerFinalReviewData && overtimeRequest.status === 'PENDING') {
          const workflow = await getApprovalWorkflow('OVERTIME', {
            department: overtimeRequest.employee?.department,
          });
          if (workflow?.requireManager) {
            results.failedIds.push(id);
            results.errors.push(`ID ${id}: 此加班申請需先由部門主管審核`);
            results.failedCount++;
            continue;
          }
        }

        let effectiveHours = overtimeRequest.totalHours;
        let overtimeType: OvertimeType = requestedOvertimeType || 'WEEKDAY';

        if (action === 'APPROVED') {
          const eligibility = await calculateOvertimeRequestEligibility(overtimeRequest, {
            overtimeType: requestedOvertimeType,
          });
          const eligibilityError = getOvertimeEligibilityError(eligibility);
          if (eligibilityError) {
            results.failedIds.push(id);
            results.errors.push(`ID ${id}: ${eligibilityError}`);
            results.failedCount++;
            continue;
          }
          effectiveHours = eligibility.effectiveHours;
          overtimeType = eligibility.overtimeType as OvertimeType;
        }

        if (action === 'APPROVED' && overtimeRequest.compensationType === 'COMP_LEAVE') {
          const yearMonth = getTaiwanYearMonth(new Date(overtimeRequest.overtimeDate));

          await prisma.$transaction(async (tx) => {
            await tx.overtimeRequest.update({
              where: { id },
              data: {
                status: action,
                approvedBy: user.employeeId,
                approvedAt: new Date(),
                overtimeType,
                ...(managerFinalReviewData ?? {}),
              }
            });

            await tx.compLeaveBalance.upsert({
              where: { employeeId: overtimeRequest.employeeId },
              update: {
                pendingEarn: { increment: effectiveHours }
              },
              create: {
                employeeId: overtimeRequest.employeeId,
                pendingEarn: effectiveHours
              }
            });

            await tx.compLeaveTransaction.create({
              data: {
                employeeId: overtimeRequest.employeeId,
                transactionType: 'EARN',
                hours: effectiveHours,
                isFrozen: false,
                referenceId: overtimeRequest.id,
                referenceType: 'OVERTIME',
                yearMonth: yearMonth,
                description: `加班審核通過 - ${overtimeRequest.reason}`
              }
            });
          });
        } else if (action === 'APPROVED' && overtimeRequest.compensationType === 'OVERTIME_PAY') {
          const payResult = await calculateOvertimePayForRequest(
            overtimeRequest.employeeId,
            overtimeRequest.overtimeDate,
            effectiveHours,
            overtimeType
          );

          if (!payResult.success) {
            results.failedIds.push(id);
            results.errors.push(`ID ${id}: 加班費計算失敗：${payResult.error || '無法取得員工薪資資料'}`);
            results.failedCount++;
            continue;
          }

          await prisma.overtimeRequest.update({
            where: { id },
            data: {
              status: action,
              approvedBy: user.employeeId,
              approvedAt: new Date(),
              overtimeType,
              overtimePay: payResult.overtimePay ?? undefined,
              hourlyRateUsed: payResult.hourlyRate ?? undefined,
              ...(managerFinalReviewData ?? {}),
            }
          });
        } else {
          // 更新申請狀態（注意：OvertimeRequest 沒有 rejectReason 欄位）
          await prisma.overtimeRequest.update({
            where: { id },
            data: {
              status: action,
              approvedBy: user.employeeId,
              approvedAt: new Date(),
              ...(managerFinalReviewData ?? {}),
            }
          });
        }

        results.successCount++;
      } catch (error) {
        console.error(`處理 ID ${id} 失敗:`, error);
        results.failedIds.push(id);
        results.errors.push(`ID ${id}: 處理失敗`);
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
    console.error('批量審核加班失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
