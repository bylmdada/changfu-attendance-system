import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { notifyLeaveApproval } from '@/lib/email';
import { notifyHRAfterManagerReview } from '@/lib/hr-notification';
import { toTaiwanDateStr } from '@/lib/timezone';
import { getApprovalWorkflow } from '@/lib/approval-workflow';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { isAnnualLeaveType, isBereavementLeaveType, splitLeaveReason } from '@/lib/leave-types';
import { validateLeaveRequest } from '@/lib/leave-rules-validator';
import { calculateLeaveDuration } from '@/lib/leave-management-helpers';
import { getLeaveDurationSchedules } from '@/lib/leave-duration-schedules';
import {
  applyApprovedLeaveAccounting,
  getAnnualLeaveHoursByDate,
} from '@/lib/annual-leave-schedule-accounting';
import { isReviewerFor } from '@/lib/approval-service';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';
import { checkAttendanceFreeze, getAttendanceFreezeError } from '@/lib/attendance-freeze';
import { isValidLeaveDurationMinutes, isValidLeaveMinute } from '@/lib/leave-time-options';
import type { Prisma } from '@prisma/client';

interface ApprovalSyncClient {
  approvalInstance?: {
    findFirst: (args: { where: { requestType: string; requestId: number } }) => Promise<{
      id: number;
      currentLevel: number;
      maxLevel: number;
      status: string;
    } | null>;
    updateMany: (args: {
      where: { id: number; currentLevel: number; status: string };
      data: { status: string; currentLevel: number };
    }) => Promise<unknown>;
  };
  approvalReview?: {
    findFirst: (args: { where: { instanceId: number; reviewerId: number; level: number } }) => Promise<{ id: number } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRequiredBereavementReason(leaveType?: string | null, reason?: string | null): boolean {
  if (!isBereavementLeaveType(leaveType)) {
    return true;
  }

  return splitLeaveReason(reason, leaveType).leaveReason.length > 0;
}

function hasLegacyBereavementReason(leaveType?: string | null, reason?: string | null): boolean {
  if (!isBereavementLeaveType(leaveType) || !reason?.trim()) {
    return false;
  }

  return splitLeaveReason(reason, leaveType).leaveReason.length === 0;
}

async function syncApprovalProgress(
  client: ApprovalSyncClient,
  params: {
    requestId: number;
    reviewerId: number;
    reviewerName: string;
    reviewerRole: string;
    action: string;
    comment?: string | null;
    nextStatus: string;
    nextLevel: number;
  }
) {
  if (!client.approvalInstance || !client.approvalReview) return;

  const instance = await client.approvalInstance.findFirst({
    where: { requestType: 'LEAVE', requestId: params.requestId }
  });
  if (!instance || instance.status === 'APPROVED' || instance.status === 'REJECTED') return;

  const existingReview = await client.approvalReview.findFirst({
    where: {
      instanceId: instance.id,
      reviewerId: params.reviewerId,
      level: instance.currentLevel
    }
  });

  if (!existingReview) {
    await client.approvalReview.create({
      data: {
        instanceId: instance.id,
        level: instance.currentLevel,
        reviewerId: params.reviewerId,
        reviewerName: params.reviewerName,
        reviewerRole: params.reviewerRole,
        action: params.action,
        comment: params.comment || null
      }
    });
  }

  await client.approvalInstance.updateMany({
    where: {
      id: instance.id,
      currentLevel: instance.currentLevel,
      status: instance.status
    },
    data: {
      status: params.nextStatus,
      currentLevel: Math.min(params.nextLevel, instance.maxLevel)
    }
  });
}

type LeaveRequestWithEmployee = Prisma.LeaveRequestGetPayload<{
  include: { employee: true };
}>;

async function finalizeLeaveRequest(params: {
  leaveRequestId: number;
  existing: LeaveRequestWithEmployee;
  status: 'APPROVED' | 'REJECTED';
  reviewerId: number;
  reviewerName: string;
  reviewerRole: string;
  approvalLevel: number;
  comment?: string | null;
  managerReview?: {
    opinion: 'AGREE' | 'DISAGREE';
    note?: string | null;
  };
}) {
  const {
    leaveRequestId,
    existing,
    status,
    reviewerId,
    reviewerName,
    reviewerRole,
    approvalLevel,
    comment,
    managerReview,
  } = params;
  const reviewedAt = new Date();
  const annualLeaveHoursByDate = status === 'APPROVED' && isAnnualLeaveType(existing.leaveType)
    ? await getAnnualLeaveHoursByDate(existing.employeeId, existing.startDate, existing.endDate)
    : {};

  const updatedLeaveRequest = await prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.update({
      where: { id: leaveRequestId, status: existing.status },
      data: {
        status,
        approvedBy: reviewerId,
        approvedAt: reviewedAt,
        ...(managerReview ? {
          managerReviewerId: reviewerId,
          managerOpinion: managerReview.opinion,
          managerNote: managerReview.note || null,
          managerReviewedAt: reviewedAt,
        } : {}),
      },
      include: {
        employee: {
          select: { id: true, employeeId: true, name: true, department: true, position: true },
        },
      },
    });

    if (status === 'APPROVED') {
      await applyApprovedLeaveAccounting(tx, existing);
    }

    await syncApprovalProgress(tx as unknown as ApprovalSyncClient, {
      requestId: leaveRequestId,
      reviewerId,
      reviewerName,
      reviewerRole,
      action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      comment: comment || null,
      nextStatus: status,
      nextLevel: approvalLevel,
    });

    return updated;
  });

  if (status === 'APPROVED') {
    await Promise.all(Array.from(new Set(
      Object.keys(annualLeaveHoursByDate).map((date) => date.slice(0, 7))
    )).map((yearMonth) => invalidateConfirmation(existing.employeeId, yearMonth)));
  }

  try {
    await notifyLeaveApproval({
      employeeId: existing.employeeId,
      employeeName: existing.employee.name,
      employeeEmail: existing.employee.email || undefined,
      approved: status === 'APPROVED',
      leaveType: existing.leaveType,
      startDate: toTaiwanDateStr(existing.startDate),
      endDate: toTaiwanDateStr(existing.endDate),
      reason: comment || undefined,
    });
  } catch (notifyError) {
    console.error('發送通知失敗:', notifyError);
  }

  return updatedLeaveRequest;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const leaveRequestIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!leaveRequestIdResult.isValid || leaveRequestIdResult.value === null) {
      return NextResponse.json({ error: '請假申請 ID 格式錯誤' }, { status: 400 });
    }
    const leaveRequestId = leaveRequestIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的請假申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的請假申請資料' }, { status: 400 });
    }

    const requestedStatus = typeof body.status === 'string' ? body.status : undefined;
    const requestedOpinion = body.opinion === 'AGREE' || body.opinion === 'DISAGREE' ? body.opinion : undefined;
    const note = typeof body.note === 'string' ? body.note : undefined;
    const rejectionReason = typeof body.rejectionReason === 'string' ? body.rejectionReason : undefined;
    const leaveType = typeof body.leaveType === 'string' ? body.leaveType : undefined;
    const startDate = typeof body.startDate === 'string' ? body.startDate : undefined;
    const endDate = typeof body.endDate === 'string' ? body.endDate : undefined;
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    const startHour = typeof body.startHour === 'string' || typeof body.startHour === 'number'
      ? String(body.startHour)
      : undefined;
    const startMinute = typeof body.startMinute === 'string' || typeof body.startMinute === 'number'
      ? String(body.startMinute)
      : undefined;
    const endHour = typeof body.endHour === 'string' || typeof body.endHour === 'number'
      ? String(body.endHour)
      : undefined;
    const endMinute = typeof body.endMinute === 'string' || typeof body.endMinute === 'number'
      ? String(body.endMinute)
      : undefined;

    // 查找請假申請
    const existing = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { employee: true }
    });

    if (!existing) {
      return NextResponse.json({ error: '找不到請假申請' }, { status: 404 });
    }

    if (requestedStatus || requestedOpinion) {
      const freezeError = getAttendanceFreezeError(
        await checkAttendanceFreeze(new Date(existing.startDate))
      );
      if (freezeError) {
        return NextResponse.json({ error: freezeError }, { status: 409 });
      }
    }

    // 若傳入 status 或 opinion，視為審核
    if (requestedStatus || requestedOpinion) {
      const managerOpinion: 'AGREE' | 'DISAGREE' | undefined = requestedOpinion
        ?? (requestedStatus === 'APPROVED' ? 'AGREE' : requestedStatus === 'REJECTED' ? 'DISAGREE' : undefined);

      if (user.role !== 'ADMIN' && user.role !== 'HR' && existing.status === 'PENDING' && managerOpinion) {
        const reviewPermission = user.employeeId && existing.employee.department
          ? await isReviewerFor(user.employeeId, existing.employee.department, 'LEAVE')
          : { isReviewer: false, role: null };

        if (!reviewPermission.isReviewer || !user.employeeId) {
          return NextResponse.json({ error: '無權限審核此部門的請假申請' }, { status: 403 });
        }

        if (!['AGREE', 'DISAGREE'].includes(managerOpinion)) {
          return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
        }

        // 取得主管資訊
        const manager = await prisma.employee.findUnique({
          where: { id: user.employeeId },
          select: { name: true }
        });

        const workflow = await getApprovalWorkflow('LEAVE', { department: existing.employee.department });
        const approvalInstance = await prisma.approvalInstance.findFirst({
          where: { requestType: 'LEAVE', requestId: leaveRequestId },
        });
        const approvalLevel = approvalInstance?.maxLevel
          ?? workflow?.approvalLevel
          ?? 2;

        if (approvalLevel <= 1) {
          const finalStatus = managerOpinion === 'AGREE' ? 'APPROVED' : 'REJECTED';
          const updatedLeaveRequest = await finalizeLeaveRequest({
            leaveRequestId,
            existing,
            status: finalStatus,
            reviewerId: user.employeeId,
            reviewerName: manager?.name || user.username,
            reviewerRole: reviewPermission.role ?? 'MANAGER',
            approvalLevel: 1,
            comment: note,
            managerReview: {
              opinion: managerOpinion,
              note,
            },
          });

          if (workflow?.enableCC) {
            await notifyHRAfterManagerReview({
              requestType: 'LEAVE',
              requestId: leaveRequestId,
              employeeName: existing.employee.name,
              employeeDepartment: existing.employee.department || '未指定',
              managerName: manager?.name || '主管',
              managerOpinion,
              managerNote: note,
            });
          }

          return NextResponse.json({
            success: true,
            leaveRequest: updatedLeaveRequest,
            message: finalStatus === 'APPROVED' ? '請假申請已批准' : '請假申請已拒絕',
          });
        }

        await prisma.leaveRequest.update({
          where: { id: leaveRequestId },
          data: {
            status: 'PENDING_ADMIN',
            managerReviewerId: user.employeeId,
            managerOpinion,
            managerNote: note || null,
            managerReviewedAt: new Date()
          }
        });
        await syncApprovalProgress(prisma as unknown as ApprovalSyncClient, {
          requestId: leaveRequestId,
          reviewerId: user.employeeId,
          reviewerName: manager?.name || user.username,
          reviewerRole: reviewPermission.role ?? 'MANAGER',
          action: managerOpinion === 'AGREE' ? 'APPROVE' : 'DISAGREE',
          comment: note || null,
          nextStatus: 'LEVEL2_REVIEWING',
          nextLevel: 2
        });

        // 檢查是否需要 CC 通知 HR
        if (workflow?.enableCC) {
          await notifyHRAfterManagerReview({
            requestType: 'LEAVE',
            requestId: leaveRequestId,
            employeeName: existing.employee.name,
            employeeDepartment: existing.employee.department || '未指定',
            managerName: manager?.name || '主管',
            managerOpinion,
            managerNote: note
          });
        }

        return NextResponse.json({
          success: true,
          message: '主管審核完成，已轉交管理員決核'
        });
      }

      // Admin / HR 最終決核
      if (user.role === 'ADMIN' || user.role === 'HR') {
        const status = requestedStatus as 'APPROVED' | 'REJECTED';
        if (!['APPROVED', 'REJECTED'].includes(status)) {
          return NextResponse.json({ error: '無效的審核狀態' }, { status: 400 });
        }

        // Admin 可以審核 PENDING 或 PENDING_ADMIN 狀態
        if (existing.status !== 'PENDING' && existing.status !== 'PENDING_ADMIN') {
          return NextResponse.json({ error: '該請假申請已經被審核過' }, { status: 400 });
        }

        const workflow = await getApprovalWorkflow('LEAVE', { department: existing.employee.department });
        if (workflow?.requireManager && existing.status === 'PENDING') {
          return NextResponse.json(
            { error: '此請假申請需先由部門主管審核，管理員或 HR 不可略過主管流程' },
            { status: 409 }
          );
        }

        const approvalInstance = await prisma.approvalInstance.findFirst({
          where: { requestType: 'LEAVE', requestId: leaveRequestId },
        });
        const approvalLevel = approvalInstance?.maxLevel
          ?? workflow?.approvalLevel
          ?? (existing.status === 'PENDING_ADMIN' ? 2 : 1);
        const updatedLeaveRequest = await finalizeLeaveRequest({
          leaveRequestId,
          existing,
          status,
          reviewerId: user.employeeId,
          reviewerName: user.username,
          reviewerRole: user.role,
          approvalLevel,
          comment: rejectionReason,
        });

        return NextResponse.json({
          success: true,
          leaveRequest: updatedLeaveRequest,
          message: status === 'APPROVED' ? '請假申請已批准' : '請假申請已拒絕'
        });
      }

      return NextResponse.json({ error: '無權限執行此操作，請假需由主管審核後由管理員或 HR 決核' }, { status: 403 });
    }

    // 否則視為「編輯」：申請人自己或管理員/HR可在待審核狀態下修改
    if (existing.status !== 'PENDING') {
      return NextResponse.json({ error: '僅能修改待審核的申請' }, { status: 400 });
    }

    if (existing.employeeId !== user.employeeId && user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限修改此申請' }, { status: 403 });
    }

    // 驗證與計算 totalDays
    let nextStart: Date | undefined;
    let nextEnd: Date | undefined;
    let nextTotalDays: number | undefined;

    const hasTime = startHour !== undefined && startMinute !== undefined && endHour !== undefined && endMinute !== undefined;
    if (hasTime && startDate && endDate) {
      // 分鐘 0..55，且以 5 分鐘為增量
      const sm = Number(startMinute);
      const em = Number(endMinute);
      const sh = Number(startHour);
      const eh = Number(endHour);
      if ([sm, em, sh, eh].some(n => Number.isNaN(n))) {
        return NextResponse.json({ error: '請輸入有效的起訖時間' }, { status: 400 });
      }
      if (!isValidLeaveMinute(sm) || !isValidLeaveMinute(em)) {
        return NextResponse.json({ error: '分鐘僅允許 0 至 55 分，並以 5 分鐘為增量' }, { status: 400 });
      }
      const s = new Date(`${startDate}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`);
      const e = new Date(`${endDate}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`);
      const diffMin = Math.round((e.getTime() - s.getTime()) / 60000);
      if (diffMin <= 0) {
        return NextResponse.json({ error: '請假時數必須為正數' }, { status: 400 });
      }
      if (!isValidLeaveDurationMinutes(diffMin)) {
        return NextResponse.json({ error: '請假時數需以 5 分鐘為增量' }, { status: 400 });
      }
      const schedulesByDate = await getLeaveDurationSchedules(existing.employeeId, startDate, endDate);
      const duration = calculateLeaveDuration({
        startDate,
        endDate,
        startHour: String(sh).padStart(2, '0'),
        startMinute: String(sm).padStart(2, '0'),
        endHour: String(eh).padStart(2, '0'),
        endMinute: String(em).padStart(2, '0'),
      }, schedulesByDate);

      if (!duration) {
        return NextResponse.json({ error: '請假時數必須落在有效排班時段內' }, { status: 400 });
      }

      nextStart = s; nextEnd = e;
      nextTotalDays = duration.totalDays;
    } else {
      // 以天為單位（如未提供時間）
      if (startDate && endDate) {
        const s = new Date(startDate);
        const e = new Date(endDate);
        const timeDiff = e.getTime() - s.getTime();
        const days = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;
        if (days <= 0) {
          return NextResponse.json({ error: '結束日期必須晚於或等於開始日期' }, { status: 400 });
        }
        nextStart = s; nextEnd = e; nextTotalDays = days;
      }
    }

    const finalLeaveType = leaveType ?? existing.leaveType;
    const finalReason = reason ?? existing.reason;
    const finalStart = nextStart ?? existing.startDate;
    const finalEnd = nextEnd ?? existing.endDate;
    const finalTotalDays = nextTotalDays ?? existing.totalDays;
    const canPreserveLegacyBereavementReason =
      hasLegacyBereavementReason(existing.leaveType, existing.reason)
      && isBereavementLeaveType(finalLeaveType)
      && (finalReason?.trim() ?? '') === (existing.reason?.trim() ?? '');

    if (!hasRequiredBereavementReason(finalLeaveType, finalReason) && !canPreserveLegacyBereavementReason) {
      return NextResponse.json({ error: '喪假申請原因需選擇法定亡故親屬關係' }, { status: 400 });
    }

    const overlappingLeaveRequest = await prisma.leaveRequest.findFirst({
      where: {
        id: { not: leaveRequestId },
        employeeId: existing.employeeId,
        status: { in: ['PENDING', 'PENDING_ADMIN', 'APPROVED'] },
        startDate: { lt: finalEnd },
        endDate: { gt: finalStart }
      }
    });

    if (overlappingLeaveRequest) {
      return NextResponse.json({ error: '該時間段已有請假申請' }, { status: 400 });
    }

    const leaveValidation = await validateLeaveRequest(
      existing.employeeId,
      finalLeaveType,
      finalTotalDays,
      finalStart.getFullYear()
    );

    if (!leaveValidation.valid) {
      return NextResponse.json({ error: leaveValidation.error }, { status: 400 });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        leaveType: finalLeaveType ?? undefined,
        startDate: nextStart ?? undefined,
        endDate: nextEnd ?? undefined,
        totalDays: nextTotalDays ?? undefined,
        reason: finalReason ?? undefined
      },
      include: {
        employee: {
          select: { id: true, employeeId: true, name: true, department: true, position: true }
        }
      }
    });

    return NextResponse.json({ success: true, leaveRequest: updated, message: '請假申請已更新' });
  } catch (error) {
    console.error('審核/更新請假申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const leaveRequestIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!leaveRequestIdResult.isValid || leaveRequestIdResult.value === null) {
      return NextResponse.json({ error: '請假申請 ID 格式錯誤' }, { status: 400 });
    }
    const leaveRequestId = leaveRequestIdResult.value;

    // 查找請假申請
    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId }
    });

    if (!leaveRequest) {
      return NextResponse.json({ error: '找不到請假申請' }, { status: 404 });
    }

    // 只有申請人或管理員可以刪除
    if (leaveRequest.employeeId !== user.employeeId && 
        user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    // 只能刪除待審核的申請
    if (leaveRequest.status !== 'PENDING') {
      return NextResponse.json({ error: '只能刪除待審核的請假申請' }, { status: 400 });
    }

    await prisma.leaveRequest.delete({
      where: { id: leaveRequestId }
    });

    return NextResponse.json({
      success: true,
      message: '請假申請已刪除'
    });
  } catch (error) {
    console.error('刪除請假申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
