import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';
import { safeParseJSON } from '@/lib/validation';
import { applyApprovedLeaveAccounting } from '@/lib/annual-leave-schedule-accounting';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { calculateOvertimePayForRequest, OvertimeType } from '@/lib/salary-utils';
import { getTaiwanYearMonth } from '@/lib/timezone';
import { findActiveScheduleFieldsForShift } from '@/lib/shift-definition-service';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';
import {
  calculateOvertimeRequestEligibility,
  getOvertimeEligibilityError,
} from '@/lib/overtime-eligibility';

function isReviewableStatus(status?: string | null) {
  return status === 'PENDING' || status === 'PENDING_ADMIN';
}

function isManagerReviewRole(role: string) {
  return role === 'MANAGER' || role === 'SUPERVISOR';
}

function isManagerReviewStage(role: string, status?: string | null) {
  return isManagerReviewRole(role) && status === 'PENDING';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

interface SelfChangePayload {
  type?: string;
  new?: string;
}

function parseSelfChangePayload(requestReason?: string | null): SelfChangePayload | null {
  if (!requestReason) {
    return null;
  }

  try {
    const parsed = JSON.parse(requestReason) as SelfChangePayload;
    return parsed?.type === 'SELF_CHANGE' ? parsed : null;
  } catch {
    return null;
  }
}

type BatchShiftExchangeApprovalClient = Pick<typeof prisma, 'shiftExchangeRequest' | 'schedule'>;

async function getScheduleUpdateDataByShift(shift: string) {
  const scheduleFields = await findActiveScheduleFieldsForShift(shift);
  if (!scheduleFields) {
    throw new Error('新班別不存在或已停用，請重新整理後再試');
  }

  return scheduleFields;
}

async function applyApprovedShiftExchange(
  tx: BatchShiftExchangeApprovalClient,
  shiftExchangeRequest: {
    id: number;
    requesterId: number;
    targetEmployeeId: number;
    originalWorkDate: string;
    targetWorkDate: string;
    requestReason?: string | null;
  },
  approverEmployeeId: number,
  approvedAt: Date,
  adminRemarks: string | null
) {
  const parsed = parseSelfChangePayload(shiftExchangeRequest.requestReason);

  if (parsed) {
    const newShift = parsed?.new ?? 'A';
    const scheduleData = await getScheduleUpdateDataByShift(newShift);
    const requesterSchedule = await tx.schedule.findFirst({
      where: {
        employeeId: shiftExchangeRequest.requesterId,
        workDate: shiftExchangeRequest.originalWorkDate,
      },
    });

    if (!requesterSchedule) {
      throw new Error('找不到申請人的班表，無法核准調班申請');
    }

    await tx.schedule.update({
      where: { id: requesterSchedule.id },
      data: scheduleData,
    });

    await tx.shiftExchangeRequest.update({
      where: { id: shiftExchangeRequest.id },
      data: {
        status: 'APPROVED',
        approvedBy: approverEmployeeId,
        approvedAt,
        adminRemarks,
      },
    });

    return;
  }

  throw new Error('員工互調功能已停用，無法核准舊互調申請');
}

// POST - 批次審核
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

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!(decoded.role === 'ADMIN' || isManagerReviewRole(decoded.role))) {
      return NextResponse.json({ error: '需要管理員或主管審核權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '缺少必要欄位' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const resourceType = isPlainObject(body) && typeof body.resourceType === 'string'
      ? body.resourceType
      : undefined;
    const rawIds = isPlainObject(body) && Array.isArray(body.ids)
      ? body.ids
      : undefined;
    const rawAction = isPlainObject(body) && typeof body.action === 'string'
      ? body.action
      : undefined;
    const normalizedAction = rawAction === 'APPROVED'
      ? 'APPROVE'
      : rawAction === 'REJECTED'
        ? 'REJECT'
        : rawAction;
    const notes = isPlainObject(body)
      ? typeof body.notes === 'string'
        ? body.notes
        : typeof body.remarks === 'string'
          ? body.remarks
          : typeof body.reason === 'string'
            ? body.reason
            : undefined
      : undefined;
    const requestedOvertimeType = isPlainObject(body) && typeof body.overtimeType === 'string'
      ? body.overtimeType
      : undefined;

    // 驗證
    if (!resourceType || !rawIds || !normalizedAction) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    if (!['APPROVE', 'REJECT'].includes(normalizedAction)) {
      return NextResponse.json({ error: '無效的審核動作' }, { status: 400 });
    }

    if (rawIds.length === 0) {
      return NextResponse.json({ error: '請選擇至少一筆申請' }, { status: 400 });
    }

    if (rawIds.length > 50) {
      return NextResponse.json({ error: '單次最多審核 50 筆' }, { status: 400 });
    }

    const ids = rawIds.reduce<number[]>((accumulator, value) => {
      const parsedId = parsePositiveInteger(value);
      if (parsedId !== undefined) {
        accumulator.push(parsedId);
      }
      return accumulator;
    }, []);

    if (ids.length !== rawIds.length) {
      return NextResponse.json({ error: '申請編號格式無效' }, { status: 400 });
    }

    const manageableDepartments = isManagerReviewRole(decoded.role)
      ? await getManageableDepartments({ role: decoded.role, employeeId: decoded.employeeId })
      : [];

    if (isManagerReviewRole(decoded.role) && manageableDepartments.length === 0) {
      return NextResponse.json({ error: '無可管理部門，無法批次審核' }, { status: 403 });
    }

    const canReviewDepartment = (department?: string | null) => {
      if (!isManagerReviewRole(decoded.role)) {
        return true;
      }

      return Boolean(department && manageableDepartments.includes(department));
    };

    const status = normalizedAction === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const managerOpinion = normalizedAction === 'APPROVE' ? 'AGREE' : 'DISAGREE';
    const results: { id: number; success: boolean; error?: string }[] = [];
    const now = new Date();

    // 根據資源類型進行批次更新
    switch (resourceType) {
      case 'LEAVE':
        for (const id of ids) {
          try {
            const existing = await prisma.leaveRequest.findUnique({
              where: { id },
              include: {
                employee: {
                  select: {
                    department: true,
                  },
                },
              },
            });
            if (!existing || !isReviewableStatus(existing.status)) {
              results.push({ id, success: false, error: '申請不存在或已審核' });
              continue;
            }

            if (!canReviewDepartment(existing.employee?.department)) {
              results.push({ id, success: false, error: '無權限審核其他部門的申請' });
              continue;
            }

            if (decoded.role !== 'ADMIN' && !isManagerReviewStage(decoded.role, existing.status)) {
              results.push({ id, success: false, error: '無權限進行最終決核' });
              continue;
            }

            if (isManagerReviewStage(decoded.role, existing.status)) {
              await prisma.leaveRequest.update({
                where: { id },
                data: {
                  status: 'PENDING_ADMIN',
                  managerReviewerId: decoded.employeeId,
                  managerOpinion,
                  managerNote: notes || null,
                  managerReviewedAt: now,
                }
              });
            } else if (status === 'APPROVED') {
              await prisma.$transaction(async (tx) => {
                await tx.leaveRequest.update({
                  where: { id, status: existing.status },
                  data: {
                    status,
                    approvedBy: decoded.employeeId,
                    approvedAt: now
                  }
                });

                await applyApprovedLeaveAccounting(tx, existing);

              });
            } else {
              await prisma.leaveRequest.update({
                where: { id },
                data: {
                  status,
                  approvedBy: decoded.employeeId,
                  approvedAt: now,
                  ...(status === 'REJECTED' ? { rejectReason: notes || null } : {})
                }
              });
            }
            results.push({ id, success: true });
          } catch {
            results.push({ id, success: false, error: '更新失敗' });
          }
        }
        break;

      case 'OVERTIME':
        for (const id of ids) {
          try {
            const existing = await prisma.overtimeRequest.findUnique({
              where: { id },
              include: {
                employee: {
                  select: {
                    department: true,
                  },
                },
              },
            });
            if (!existing || !isReviewableStatus(existing.status)) {
              results.push({ id, success: false, error: '申請不存在或已審核' });
              continue;
            }

            if (!canReviewDepartment(existing.employee?.department)) {
              results.push({ id, success: false, error: '無權限審核其他部門的申請' });
              continue;
            }

            if (decoded.role !== 'ADMIN' && !isManagerReviewStage(decoded.role, existing.status)) {
              results.push({ id, success: false, error: '無權限進行最終決核' });
              continue;
            }

            let effectiveHours = existing.totalHours;
            let overtimeType: OvertimeType | undefined;

            if (!isManagerReviewStage(decoded.role, existing.status) && status === 'APPROVED') {
              const eligibility = await calculateOvertimeRequestEligibility(existing, {
                overtimeType: requestedOvertimeType as OvertimeType | undefined,
              });
              const eligibilityError = getOvertimeEligibilityError(eligibility);
              if (eligibilityError) {
                results.push({ id, success: false, error: eligibilityError });
                continue;
              }

              effectiveHours = eligibility.effectiveHours;
              overtimeType = eligibility.overtimeType;
            }

            if (isManagerReviewStage(decoded.role, existing.status)) {
              await prisma.overtimeRequest.update({
                where: { id },
                data: {
                  status: 'PENDING_ADMIN',
                  managerReviewerId: decoded.employeeId,
                  managerOpinion,
                  managerNote: notes || null,
                  managerReviewedAt: now,
                }
              });
            } else if (status === 'APPROVED' && existing.compensationType === 'COMP_LEAVE') {
                    const yearMonth = getTaiwanYearMonth(new Date(existing.overtimeDate));

              await prisma.$transaction(async (tx) => {
                await tx.overtimeRequest.update({
                  where: { id },
                  data: {
                    status,
                    approvedBy: decoded.employeeId,
                    approvedAt: now,
                    overtimeType,
                  }
                });

                await tx.compLeaveTransaction.create({
                  data: {
                    employeeId: existing.employeeId,
                    transactionType: 'EARN',
                    hours: effectiveHours,
                    isFrozen: false,
                    referenceId: existing.id,
                    referenceType: 'OVERTIME',
                    yearMonth,
                    description: `加班申請 #${existing.id} 核准（批次審核）`
                  }
                });

                await tx.compLeaveBalance.upsert({
                  where: { employeeId: existing.employeeId },
                  update: {
                    pendingEarn: { increment: effectiveHours }
                  },
                  create: {
                    employeeId: existing.employeeId,
                    totalEarned: 0,
                    totalUsed: 0,
                    balance: 0,
                    pendingEarn: effectiveHours,
                    pendingUse: 0
                  }
                });
              });
            } else {
              let overtimePay: number | undefined;
              let hourlyRateUsed: number | undefined;

              if (status === 'APPROVED' && existing.compensationType === 'OVERTIME_PAY') {
                const payResult = await calculateOvertimePayForRequest(
                  existing.employeeId,
                  existing.overtimeDate,
                  effectiveHours,
                  overtimeType ?? 'WEEKDAY'
                );

                if (payResult.success) {
                  overtimePay = payResult.overtimePay ?? undefined;
                  hourlyRateUsed = payResult.hourlyRate ?? undefined;
                } else {
                  console.error('批次計算加班費失敗:', payResult.error);
                  results.push({
                    id,
                    success: false,
                    error: `加班費計算失敗：${payResult.error || '無法取得員工薪資資料'}`,
                  });
                  continue;
                }
              }

              await prisma.overtimeRequest.update({
                where: { id },
                data: {
                  status,
                  approvedBy: decoded.employeeId,
                  approvedAt: now,
                  overtimeType,
                  overtimePay,
                  hourlyRateUsed,
                  ...(status === 'REJECTED' ? { rejectReason: notes || null } : {})
                }
              });
            }
            
            results.push({ id, success: true });
          } catch {
            results.push({ id, success: false, error: '更新失敗' });
          }
        }
        break;

      case 'SHIFT_EXCHANGE':
        for (const id of ids) {
          try {
            const existing = await prisma.shiftExchangeRequest.findUnique({
              where: { id },
              include: {
                requester: {
                  select: {
                    department: true,
                  },
                },
              },
            });
            if (!existing || !isReviewableStatus(existing.status)) {
              results.push({ id, success: false, error: '申請不存在或已審核' });
              continue;
            }

            if (!canReviewDepartment(existing.requester?.department)) {
              results.push({ id, success: false, error: '無權限審核其他部門的申請' });
              continue;
            }

            if (decoded.role !== 'ADMIN' && !isManagerReviewStage(decoded.role, existing.status)) {
              results.push({ id, success: false, error: '無權限進行最終決核' });
              continue;
            }

            if (isManagerReviewStage(decoded.role, existing.status)) {
              await prisma.shiftExchangeRequest.update({
                where: { id },
                data: {
                  status: 'PENDING_ADMIN',
                  managerReviewerId: decoded.employeeId,
                  managerOpinion,
                  managerNote: notes || null,
                  managerReviewedAt: now
                }
              });
            } else if (status === 'APPROVED') {
              if (!parseSelfChangePayload(existing.requestReason)) {
                results.push({ id, success: false, error: '員工互調功能已停用，無法核准舊互調申請' });
                continue;
              }

              const originalDateObj = new Date(existing.originalWorkDate);
              const freezeCheck = await checkAttendanceFreeze(originalDateObj);
              if (freezeCheck.isFrozen) {
                const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
                results.push({
                  id,
                  success: false,
                  error: `該月份已被凍結，無法核准調班申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
                });
                continue;
              }

              await prisma.$transaction(async (tx) => {
                await applyApprovedShiftExchange(
                  tx as BatchShiftExchangeApprovalClient,
                  {
                    id: existing.id,
                    requesterId: existing.requesterId,
                    targetEmployeeId: existing.targetEmployeeId,
                    originalWorkDate: existing.originalWorkDate,
                    targetWorkDate: existing.targetWorkDate,
                    requestReason: existing.requestReason,
                  },
                  decoded.employeeId,
                  now,
                  notes || null
                );
              });
              await invalidateConfirmation(existing.requesterId, existing.originalWorkDate.slice(0, 7));
            } else {
              await prisma.shiftExchangeRequest.update({
                where: { id },
                data: {
                  status,
                  approvedBy: decoded.employeeId,
                  approvedAt: now,
                  ...(status === 'REJECTED' ? { adminRemarks: notes || null } : {})
                }
              });
            }
            results.push({ id, success: true });
          } catch (error) {
            results.push({
              id,
              success: false,
              error: error instanceof Error && error.message ? error.message : '更新失敗'
            });
          }
        }
        break;

      default:
        return NextResponse.json({ error: '不支援的資源類型' }, { status: 400 });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    // 審計日誌不應覆蓋已提交的批次審核結果。
    try {
      await prisma.auditLog.create({
        data: {
          userId: decoded.userId,
          employeeId: decoded.employeeId,
          action: 'BATCH_APPROVE',
          targetType: resourceType,
          description: `批次${normalizedAction === 'APPROVE' ? '核准' : '拒絕'} ${successCount}/${ids.length} 筆${notes ? ` - ${notes}` : ''}`,
          newValue: JSON.stringify({ ids, action: normalizedAction, results }),
          success: failCount === 0
        }
      });
    } catch (auditLogError) {
      console.error('批次審核審計日誌寫入失敗:', auditLogError);
    }

    const failedIds = results
      .filter((result) => !result.success)
      .map((result) => result.id);

    if (successCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: results[0]?.error || '批次審核失敗',
          summary: {
            total: ids.length,
            success: successCount,
            failed: failCount,
          },
          failedIds,
          results,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `批次審核完成：成功 ${successCount} 筆，失敗 ${failCount} 筆`,
      summary: {
        total: ids.length,
        success: successCount,
        failed: failCount
      },
      failedIds,
      results
    });
  } catch (error) {
    console.error('批次審核失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
