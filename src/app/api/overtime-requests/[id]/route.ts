import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { notifyOvertimeApproval } from '@/lib/email';
import { calculateOvertimePayForRequest, OvertimeType } from '@/lib/salary-utils';
import { toTaiwanDateStr, getTaiwanYearMonth } from '@/lib/timezone';
import { notifyHRAfterManagerReview } from '@/lib/hr-notification';
import { getApprovalWorkflow } from '@/lib/approval-workflow';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { getStoredOvertimeCalculationSettings } from '@/lib/overtime-settings';
import { isReviewerFor } from '@/lib/approval-service';
import {
  calculateActualOvertimeHoursFromTimeRange,
  getMinimumOvertimeHours,
} from '@/lib/overtime-hours';
import { checkAttendanceFreeze, getAttendanceFreezeError } from '@/lib/attendance-freeze';
import {
  calculateOvertimeRequestEligibility,
  getOvertimeEligibilityError,
} from '@/lib/overtime-eligibility';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 審核或編輯加班申請
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/overtime-requests/[id]');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const overtimeRequestIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!overtimeRequestIdResult.isValid || overtimeRequestIdResult.value === null) {
      return NextResponse.json({ error: '加班申請 ID 格式錯誤' }, { status: 400 });
    }
    const overtimeRequestId = overtimeRequestIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的加班申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的加班申請資料' }, { status: 400 });
    }

    const requestedStatus = typeof body.status === 'string' ? body.status : undefined;
    const requestedOpinion = body.opinion === 'AGREE' || body.opinion === 'DISAGREE' ? body.opinion : undefined;
    const note = typeof body.note === 'string' ? body.note : undefined;
    const requestedOvertimeType = typeof body.overtimeType === 'string'
      ? body.overtimeType as OvertimeType
      : undefined;
    const rejectionReason = typeof body.rejectionReason === 'string' ? body.rejectionReason : undefined;
    const overtimeDate = typeof body.overtimeDate === 'string' ? body.overtimeDate : undefined;
    const startTime = typeof body.startTime === 'string' ? body.startTime : undefined;
    const endTime = typeof body.endTime === 'string' ? body.endTime : undefined;
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    const workContent = typeof body.workContent === 'string' ? body.workContent : undefined;

    // 查找加班申請
    const existing = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeRequestId },
      include: { employee: true }
    });

    if (!existing) {
      return NextResponse.json({ error: '找不到加班申請' }, { status: 404 });
    }

    if (requestedStatus || requestedOpinion) {
      const freezeError = getAttendanceFreezeError(
        await checkAttendanceFreeze(existing.overtimeDate)
      );
      if (freezeError) {
        return NextResponse.json({ error: freezeError }, { status: 409 });
      }
    }

    // 若傳入 status 或 opinion，視為審核
    if (requestedStatus || requestedOpinion) {
      const managerOpinion: 'AGREE' | 'DISAGREE' | undefined = requestedOpinion
        ?? (requestedStatus === 'APPROVED' ? 'AGREE' : requestedStatus === 'REJECTED' ? 'DISAGREE' : undefined);
      let managerFinalReviewData: {
        managerReviewerId: number;
        managerOpinion: 'AGREE' | 'DISAGREE';
        managerNote: string | null;
        managerReviewedAt: Date;
      } | null = null;

      if (user.role !== 'ADMIN' && user.role !== 'HR' && existing.status === 'PENDING' && managerOpinion) {
        const reviewPermission = user.employeeId && existing.employee.department
          ? await isReviewerFor(user.employeeId, existing.employee.department, 'OVERTIME')
          : { isReviewer: false };

        if (!reviewPermission.isReviewer || !user.employeeId) {
          return NextResponse.json({ error: '無權限審核此部門的加班申請' }, { status: 403 });
        }

        if (!['AGREE', 'DISAGREE'].includes(managerOpinion)) {
          return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
        }

        // 取得主管資訊
        const manager = await prisma.employee.findUnique({
          where: { id: user.employeeId },
          select: { name: true }
        });

        const workflow = await getApprovalWorkflow('OVERTIME', { department: existing.employee.department });
        const reviewedAt = new Date();
        managerFinalReviewData = {
          managerReviewerId: user.employeeId,
          managerOpinion,
          managerNote: note || null,
          managerReviewedAt: reviewedAt,
        };

        if ((workflow?.approvalLevel ?? 2) > 1) {
          await prisma.overtimeRequest.update({
            where: { id: overtimeRequestId },
            data: {
              status: 'PENDING_ADMIN',
              ...managerFinalReviewData,
            }
          });

          // 檢查是否需要 CC 通知 HR
          if (workflow?.enableCC) {
            await notifyHRAfterManagerReview({
              requestType: 'OVERTIME',
              requestId: overtimeRequestId,
              employeeName: existing.employee.name,
              employeeDepartment: existing.employee.department || '未指定',
              managerName: manager?.name || '主管',
              managerOpinion,
              managerNote: note
            });
          }

          return NextResponse.json({
            success: true,
            message: '主管審核完成，已轉交最終審核'
          });
        }
      }

      // ADMIN / HR 最終決核，或一階流程由主管直接決核
      if (user.role === 'ADMIN' || user.role === 'HR' || managerFinalReviewData) {
        const status = managerFinalReviewData
          ? (managerOpinion === 'AGREE' ? 'APPROVED' : 'REJECTED')
          : requestedStatus as 'APPROVED' | 'REJECTED';

        if (!['APPROVED', 'REJECTED'].includes(status ?? '')) {
          return NextResponse.json({ error: '無效的審核狀態' }, { status: 400 });
        }

        // Admin 可以審核 PENDING 或 PENDING_ADMIN 狀態
        if (existing.status !== 'PENDING' && existing.status !== 'PENDING_ADMIN') {
          return NextResponse.json({ error: '該加班申請已經被審核過' }, { status: 400 });
        }

        const workflow = await getApprovalWorkflow('OVERTIME', { department: existing.employee.department });
        if (!managerFinalReviewData && workflow?.requireManager && existing.status === 'PENDING') {
          return NextResponse.json(
            { error: '此加班申請需先由部門主管審核，管理員或 HR 不可略過主管流程' },
            { status: 409 }
          );
        }

        // 如果選擇加班費，計算加班費金額
        let overtimePay: number | null = null;
        let hourlyRateUsed: number | null = null;
        let overtimeType: OvertimeType = 'WEEKDAY';
        let effectiveHours = existing.totalHours;

        if (status === 'APPROVED') {
          const eligibility = await calculateOvertimeRequestEligibility(existing, {
            overtimeType: requestedOvertimeType,
          });
          const eligibilityError = getOvertimeEligibilityError(eligibility);
          if (eligibilityError) {
            return NextResponse.json({ error: eligibilityError }, { status: 400 });
          }
          effectiveHours = eligibility.effectiveHours;
          overtimeType = eligibility.overtimeType;
        }

        if (status === 'APPROVED' && existing.compensationType === 'OVERTIME_PAY') {
          const payResult = await calculateOvertimePayForRequest(
            existing.employeeId,
            existing.overtimeDate,
            effectiveHours,
            overtimeType
          );

          if (payResult.success) {
            overtimePay = payResult.overtimePay ?? null;
            hourlyRateUsed = payResult.hourlyRate ?? null;
          } else {
            console.error('計算加班費失敗:', payResult.error);
            return NextResponse.json(
              { error: `加班費計算失敗：${payResult.error || '無法取得員工薪資資料'}` },
              { status: 400 }
            );
          }
        }

        const updatedOvertimeRequest = status === 'APPROVED' && existing.compensationType === 'COMP_LEAVE'
          ? await prisma.$transaction(async (tx) => {
              const updatedRequest = await tx.overtimeRequest.update({
                where: { id: overtimeRequestId },
                data: {
                  status,
                  approvedBy: user.employeeId,
                  approvedAt: new Date(),
                  overtimeType: overtimeType || undefined,
                  overtimePay: overtimePay || undefined,
                  hourlyRateUsed: hourlyRateUsed || undefined,
                  ...(managerFinalReviewData ?? {}),
                },
                include: {
                  employee: {
                    select: { id: true, employeeId: true, name: true, department: true, position: true }
                  }
                }
              });

              const yearMonth = getTaiwanYearMonth(new Date(existing.overtimeDate));

              await tx.compLeaveTransaction.create({
                data: {
                  employeeId: existing.employeeId,
                  transactionType: 'EARN',
                  hours: effectiveHours,
                  referenceId: overtimeRequestId,
                  referenceType: 'OVERTIME',
                  yearMonth,
                  description: `加班審核通過 - ${existing.reason}`,
                  isFrozen: false
                }
              });

              await tx.compLeaveBalance.upsert({
                where: { employeeId: existing.employeeId },
                update: {
                  pendingEarn: { increment: effectiveHours }
                },
                create: {
                  employeeId: existing.employeeId,
                  pendingEarn: effectiveHours
                }
              });

              return updatedRequest;
            })
          : await prisma.overtimeRequest.update({
              where: { id: overtimeRequestId },
              data: {
                status,
                approvedBy: user.employeeId,
                approvedAt: new Date(),
                overtimeType: overtimeType || undefined,
                overtimePay: overtimePay || undefined,
                hourlyRateUsed: hourlyRateUsed || undefined,
                ...(managerFinalReviewData ?? {}),
              },
              include: {
                employee: {
                  select: { id: true, employeeId: true, name: true, department: true, position: true }
                }
              }
            });

        // 發送審核結果通知
        try {
          await notifyOvertimeApproval({
            employeeId: existing.employeeId,
            employeeName: existing.employee.name,
            employeeEmail: existing.employee.email || undefined,
            approved: status === 'APPROVED',
            overtimeDate: toTaiwanDateStr(existing.overtimeDate),
            hours: status === 'APPROVED' ? effectiveHours : existing.totalHours,
            reason: rejectionReason,
          });
        } catch (notifyError) {
          console.error('發送通知失敗:', notifyError);
        }

        return NextResponse.json({
          success: true,
          overtimeRequest: updatedOvertimeRequest,
          message: status === 'APPROVED' ? '加班申請已批准' : '加班申請已拒絕'
        });
      }

      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    // 否則視為「編輯」：申請人、管理員/HR，或該部門的有效審核主管可修改待審核申請
    if (existing.status !== 'PENDING') {
      return NextResponse.json({ error: '僅能修改待審核的申請' }, { status: 400 });
    }

    let canEdit = existing.employeeId === user.employeeId || user.role === 'ADMIN' || user.role === 'HR';
    if (!canEdit && user.employeeId && existing.employee.department) {
      const reviewPermission = await isReviewerFor(
        user.employeeId,
        existing.employee.department,
        'OVERTIME'
      );
      canEdit = reviewPermission.isReviewer;
    }

    if (!canEdit) {
      return NextResponse.json({ error: '無權限修改此申請' }, { status: 403 });
    }

    // 驗證變更（若提供）
    if (startTime) {
      const [startHour] = startTime.split(':').map(Number);
      if (startHour < 17) {
        return NextResponse.json({ error: '加班開始時間必須在17:00之後（正常工作8小時後）' }, { status: 400 });
      }
    }

    const overtimeSettings = await getStoredOvertimeCalculationSettings();
    const minimumOvertimeHours = getMinimumOvertimeHours(overtimeSettings.overtimeMinUnit);
    let totalHours: number | undefined = existing.totalHours;
    if (startTime || endTime) {
      const nextStartTime = startTime ?? existing.startTime;
      const nextEndTime = endTime ?? existing.endTime;
      const actualHours = calculateActualOvertimeHoursFromTimeRange(nextStartTime, nextEndTime);
      if (actualHours === null) {
        return NextResponse.json({ error: '加班時間格式無效' }, { status: 400 });
      }
      if (actualHours < minimumOvertimeHours) {
        return NextResponse.json({ error: `加班時數最少${minimumOvertimeHours}小時` }, { status: 400 });
      }
      if (actualHours > 4) {
        return NextResponse.json({ error: '單日加班時數不能超過4小時' }, { status: 400 });
      }
      if ((8 + actualHours) > 12) {
        return NextResponse.json({ error: '一天工作時間不能超過12小時' }, { status: 400 });
      }
      totalHours = actualHours;
    }

    const updated = await prisma.overtimeRequest.update({
      where: { id: overtimeRequestId },
      data: {
        overtimeDate: overtimeDate ? new Date(overtimeDate) : undefined,
        startTime: startTime ?? undefined,
        endTime: endTime ?? undefined,
        totalHours: totalHours ?? undefined,
        reason: reason ?? undefined,
        workContent: workContent ?? undefined
      },
      include: {
        employee: {
          select: { id: true, employeeId: true, name: true, department: true, position: true }
        }
      }
    });

    return NextResponse.json({ success: true, overtimeRequest: updated, message: '加班申請已更新' });
  } catch (error) {
    console.error('審核/更新加班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 刪除加班申請
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/overtime-requests/[id]');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const overtimeRequestIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!overtimeRequestIdResult.isValid || overtimeRequestIdResult.value === null) {
      return NextResponse.json({ error: '加班申請 ID 格式錯誤' }, { status: 400 });
    }
    const overtimeRequestId = overtimeRequestIdResult.value;

    // 查找加班申請
    const overtimeRequest = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeRequestId }
    });

    if (!overtimeRequest) {
      return NextResponse.json({ error: '找不到加班申請' }, { status: 404 });
    }

    // 只有申請人或管理員可以刪除
    if (overtimeRequest.employeeId !== user.employeeId && 
        user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    // 只能刪除待審核的申請
    if (overtimeRequest.status !== 'PENDING') {
      return NextResponse.json({ error: '只能刪除待審核的加班申請' }, { status: 400 });
    }

    await prisma.overtimeRequest.delete({
      where: { id: overtimeRequestId }
    });

    return NextResponse.json({
      success: true,
      message: '加班申請已刪除'
    });
  } catch (error) {
    console.error('刪除加班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
