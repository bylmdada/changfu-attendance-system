import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { canAccessAttendanceDepartment } from '@/lib/attendance-permission-scopes';
import { findActiveScheduleFieldsForShift, findActiveShiftDefinition } from '@/lib/shift-definition-service';
import { getApprovalWorkflow } from '@/lib/approval-workflow';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';

interface EmployeeLite { id: number; employeeId: string; name: string; position: string; department?: string }
interface ShiftExchangeLite {
  id: number;
  requesterId: number;
  targetEmployeeId: number;
  originalWorkDate: string;
  targetWorkDate: string;
  requestReason: string;
  originalShiftType?: string | null;
  newShiftType?: string | null;
  leaveType?: string | null;
  status: 'PENDING' | 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'VOIDED';
  adminRemarks?: string | null;
  approvedBy?: number | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  requester?: EmployeeLite;
  targetEmployee?: EmployeeLite;
  approver?: EmployeeLite | null;
}
interface IncludeShape {
  requester?: { select: Record<string, boolean> };
  targetEmployee?: { select: Record<string, boolean> };
  approver?: { select: Record<string, boolean> };
}
interface PrismaShiftExchangeClient {
  shiftExchangeRequest?: {
    findUnique: (args: { where: { id: number }; include?: IncludeShape }) => Promise<ShiftExchangeLite | null>;
    update: (args: { where: { id: number }; data: Record<string, unknown>; include?: IncludeShape }) => Promise<ShiftExchangeLite>;
    delete?: (args: { where: { id: number } }) => Promise<unknown>;
  };
  schedule?: {
    findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: number; shiftType: string; startTime: string; endTime: string } | null>;
    update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: Omit<PrismaShiftExchangeClient, '$transaction'>) => Promise<T>) => Promise<T>;
}

interface ApprovalSelfChangePayload {
  type?: string;
  shiftDate?: string;
  original?: string;
  new?: string;
  note?: string;
  leaveType?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const db = prisma as unknown as PrismaShiftExchangeClient;

function parseSelfChangePayload(requestReason: string): ApprovalSelfChangePayload | null {
  try {
    const parsed = JSON.parse(requestReason) as ApprovalSelfChangePayload;
    return parsed?.type === 'SELF_CHANGE' ? parsed : null;
  } catch {
    return null;
  }
}

function getSelfChangePayload(request: Pick<ShiftExchangeLite, 'originalWorkDate' | 'requestReason' | 'originalShiftType' | 'newShiftType' | 'leaveType'>) {
  if (request.originalShiftType && request.newShiftType) {
    return {
      type: 'SELF_CHANGE',
      shiftDate: request.originalWorkDate,
      original: request.originalShiftType,
      new: request.newShiftType,
      note: request.requestReason,
      leaveType: request.leaveType ?? undefined,
    };
  }

  const legacy = parseSelfChangePayload(request.requestReason);
  return legacy?.original && legacy.new ? legacy : null;
}

async function getScheduleUpdateDataByShift(shift: string) {
  const scheduleFields = await findActiveScheduleFieldsForShift(shift);
  if (!scheduleFields) {
    throw new Error('新班別不存在或已停用，請重新整理後再試');
  }

  return scheduleFields;
}

async function applyApprovedShiftExchange(
  tx: Omit<PrismaShiftExchangeClient, '$transaction'>,
  shiftExchangeRequest: Pick<ShiftExchangeLite, 'id' | 'requesterId' | 'targetEmployeeId' | 'originalWorkDate' | 'targetWorkDate' | 'requestReason' | 'originalShiftType' | 'newShiftType' | 'leaveType'>,
  approverEmployeeId: number,
  approvedAt: Date,
  adminRemarks: string | null
) {
  if (!tx.shiftExchangeRequest || !tx.schedule) {
    throw new Error('班表功能暫不可用，無法核准調班申請');
  }

  const parsed = getSelfChangePayload(shiftExchangeRequest);

  if (parsed) {
    const newShift = parsed.new;
    if (!newShift) {
      throw new Error('調班資料缺少新班別，無法核准');
    }
    const scheduleData = await getScheduleUpdateDataByShift(newShift);
    const original = await tx.schedule.findFirst({
      where: { employeeId: shiftExchangeRequest.requesterId, workDate: shiftExchangeRequest.originalWorkDate }
    });

    if (!original) {
      throw new Error('找不到申請人的班表，無法核准調班申請');
    }

    await tx.schedule.update({
      where: { id: original.id },
      data: scheduleData,
    });

    return tx.shiftExchangeRequest.update({
      where: { id: shiftExchangeRequest.id },
      data: {
        status: 'APPROVED',
        approvedBy: approverEmployeeId,
        approvedAt,
        adminRemarks,
      },
      include: {
        requester: { select: { id: true, employeeId: true, name: true, position: true, department: true } },
        targetEmployee: { select: { id: true, employeeId: true, name: true, position: true, department: true } },
        approver: { select: { id: true, employeeId: true, name: true, position: true } }
      }
    });
  }

  throw new Error('員工互調功能已停用，無法核准舊互調申請');
}

// PATCH - 審核調班申請（批准/拒絕）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的調班申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的調班申請資料' }, { status: 400 });
    }

    const rawAction = typeof body.action === 'string' ? body.action : undefined;
    const remarks = typeof body.remarks === 'string' ? body.remarks : undefined;
    const status = typeof body.status === 'string' ? body.status : undefined;
    const opinion = body.opinion === 'AGREE' || body.opinion === 'DISAGREE' ? body.opinion : undefined;

    // 兼容舊前端：若傳入 status，映射為 action（僅管理員/HR才能審核）
    let action = rawAction as 'approve' | 'reject' | undefined;
    if (!action && status) {
      if (String(status).toUpperCase() === 'APPROVED') action = 'approve';
      if (String(status).toUpperCase() === 'REJECTED') action = 'reject';
    }

    const { id } = await params;
    const requestIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!requestIdResult.isValid || requestIdResult.value === null) {
      return NextResponse.json({ error: '調班申請 ID 格式錯誤' }, { status: 400 });
    }
    const requestId = requestIdResult.value;

    if (!db.shiftExchangeRequest || typeof db.shiftExchangeRequest.findUnique !== 'function') {
      return NextResponse.json({ error: '功能暫不可用' }, { status: 503 });
    }

    const current = await db.shiftExchangeRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, department: true } },
        targetEmployee: { select: { id: true } }
      }
    });

    if (!current) {
      return NextResponse.json({ error: '調班申請不存在' }, { status: 404 });
    }

    const selfChangePayload = getSelfChangePayload(current);
    const workflow = await getApprovalWorkflow('SHIFT_CHANGE', { department: current.requester?.department });

    // 如果是審核流程（二階審核：主管→Admin）
    if (action || opinion) {
      const managerOpinion: 'AGREE' | 'DISAGREE' | undefined = opinion
        ?? (action === 'approve' ? 'AGREE' : action === 'reject' ? 'DISAGREE' : undefined);

      if (user.role !== 'ADMIN' && user.role !== 'HR' && current.status === 'PENDING' && managerOpinion) {
        if (!workflow?.requireManager) {
          return NextResponse.json(
            { error: '此調班流程不需主管審核，請由管理員直接決核' },
            { status: 409 }
          );
        }

        const canReviewDepartment = await canAccessAttendanceDepartment(
          { role: user.role, employeeId: user.employeeId },
          current.requester?.department,
          'shiftExchanges'
        );

        if (!canReviewDepartment || !user.employeeId) {
          return NextResponse.json({ error: '無權限審核此部門的調班申請' }, { status: 403 });
        }

        if (!['AGREE', 'DISAGREE'].includes(managerOpinion)) {
          return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
        }

        const updatedRequest = await db.shiftExchangeRequest.update({
          where: { id: requestId },
          data: {
            status: 'PENDING_ADMIN',
            managerReviewerId: user.employeeId,
            managerOpinion,
            managerNote: remarks || null,
            managerReviewedAt: new Date()
          },
          include: {
            requester: { select: { id: true, employeeId: true, name: true, position: true, department: true } },
            targetEmployee: { select: { id: true, employeeId: true, name: true, position: true, department: true } },
            approver: { select: { id: true, employeeId: true, name: true, position: true } }
          }
        });

        return NextResponse.json({
          success: true,
          message: '主管審核完成，已轉交管理員決核',
          request: updatedRequest
        });
      }

      // Admin 最終決核
      if (user.role === 'ADMIN') {
        // Admin 可以審核 PENDING 或 PENDING_ADMIN 狀態
        if (current.status !== 'PENDING' && current.status !== 'PENDING_ADMIN') {
          return NextResponse.json({ error: '此申請已被處理' }, { status: 400 });
        }
        if (workflow?.requireManager && current.status === 'PENDING') {
          return NextResponse.json(
            { error: '此調班申請需先由部門主管審核，管理員不可略過主管流程' },
            { status: 409 }
          );
        }

        // 核准時檢查凍結狀態
        if (action === 'approve') {
          if (!selfChangePayload) {
            return NextResponse.json({ error: '員工互調功能已停用，無法核准舊互調申請' }, { status: 400 });
          }

          const originalDateObj = new Date(current.originalWorkDate);
          const freezeCheck = await checkAttendanceFreeze(originalDateObj);
          if (freezeCheck.isFrozen) {
            const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
            return NextResponse.json({
              error: `該月份已被凍結，無法核准調班申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
            }, { status: 403 });
          }
        }

        const now = new Date();

        if (action === 'approve') {
          if (!db.$transaction || !db.schedule) {
            return NextResponse.json({ error: '班表功能暫不可用，無法核准調班申請' }, { status: 503 });
          }

          try {
            const updatedRequest = await db.$transaction((tx) =>
              applyApprovedShiftExchange(
                tx,
                {
                  id: current.id,
                  requesterId: current.requesterId,
                  targetEmployeeId: current.targetEmployeeId,
                  originalWorkDate: current.originalWorkDate,
                  targetWorkDate: current.targetWorkDate,
                  requestReason: current.requestReason,
                  originalShiftType: current.originalShiftType,
                  newShiftType: current.newShiftType,
                  leaveType: current.leaveType,
                },
                user.employeeId,
                now,
                remarks || null
              )
            );

            await invalidateConfirmation(current.requesterId, current.originalWorkDate.slice(0, 7));

            return NextResponse.json(updatedRequest);
          } catch (error) {
            if (error instanceof Error && error.message) {
              const statusCode = error.message.includes('新班別')
                ? 400
                : error.message.includes('班表')
                  ? 409
                  : 503;
              return NextResponse.json({ error: error.message }, { status: statusCode });
            }
            throw error;
          }
        }

        const updatedRequest = await db.shiftExchangeRequest.update({
          where: { id: requestId },
          data: {
            status: 'REJECTED',
            approvedBy: user.employeeId,
            approvedAt: now,
            adminRemarks: remarks || null
          },
          include: {
            requester: { select: { id: true, employeeId: true, name: true, position: true, department: true } },
            targetEmployee: { select: { id: true, employeeId: true, name: true, position: true, department: true } },
            approver: { select: { id: true, employeeId: true, name: true, position: true } }
          }
        });

        return NextResponse.json(updatedRequest);
      }

      // HR 不能直接審核
      return NextResponse.json({ error: '無權限執行此操作，調班需由主管審核後由管理員決核' }, { status: 403 });
    }

    // 否則視為編輯：僅申請者本人或管理員/HR，且僅限 PENDING
    if (current.status !== 'PENDING') {
      return NextResponse.json({ error: '僅能修改待審核的申請' }, { status: 400 });
    }
    const isOwner = user.employeeId === current.requesterId;
    if (!isOwner && user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限修改此申請' }, { status: 403 });
    }

    if (!selfChangePayload) {
      return NextResponse.json({ error: '員工互調功能已停用，無法修改舊互調申請' }, { status: 400 });
    }

    let dataToUpdate: Record<string, unknown> = {};

    const shiftDate = body.shiftDate ?? selfChangePayload.shiftDate ?? current.originalWorkDate;
    const original = body.originalShiftType ?? selfChangePayload.original;
    const next = body.newShiftType ?? selfChangePayload.new;
    const note = body.reason ?? selfChangePayload.note ?? '';
    const leaveType = body.leaveType ?? selfChangePayload.leaveType ?? '';

    if (typeof original !== 'string' || !original || typeof next !== 'string' || !next) {
      return NextResponse.json({ error: '調班資料缺少原班別或新班別' }, { status: 400 });
    }

    const nextShift = await findActiveShiftDefinition(next);
    if (!nextShift) {
      return NextResponse.json({ error: '新班別不存在或已停用，請重新整理後再試' }, { status: 400 });
    }

    if (next === 'FDL' && !leaveType) {
      return NextResponse.json({ error: '調班為全日請假時，請選擇請假類型' }, { status: 400 });
    }

    dataToUpdate = {
      originalWorkDate: String(shiftDate),
      targetWorkDate: String(shiftDate),
      requestReason: String(note),
      originalShiftType: original,
      newShiftType: next,
      leaveType: next === 'FDL' ? String(leaveType) : null,
    };

    const updated = await db.shiftExchangeRequest.update({
      where: { id: requestId },
      data: dataToUpdate,
      include: {
        requester: { select: { id: true, employeeId: true, name: true, position: true, department: true } },
        targetEmployee: { select: { id: true, employeeId: true, name: true, position: true, department: true } },
        approver: { select: { id: true, employeeId: true, name: true, position: true } }
      }
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('更新調班申請失敗:', error);
    return NextResponse.json({ error: '更新調班申請失敗' }, { status: 500 });
  }
}

// 刪除待審核的調班申請
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: '未授權' }, { status: 401 });

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    if (!db.shiftExchangeRequest) return NextResponse.json({ error: '功能暫不可用' }, { status: 503 });

    const { id } = await params;
    const requestIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!requestIdResult.isValid || requestIdResult.value === null) {
      return NextResponse.json({ error: '調班申請 ID 格式錯誤' }, { status: 400 });
    }
    const requestId = requestIdResult.value;
    const current = await db.shiftExchangeRequest.findUnique({ where: { id: requestId } });
    if (!current) return NextResponse.json({ error: '調班申請不存在' }, { status: 404 });

    const isOwner = user.employeeId === current.requesterId;
    if (!isOwner && user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限刪除此申請' }, { status: 403 });
    }

    if (current.status !== 'PENDING') {
      return NextResponse.json({ error: '僅能刪除待審核的申請' }, { status: 400 });
    }

    // 嘗試物理刪除；若不支援則降級為標記 REJECTED
    if (typeof db.shiftExchangeRequest.delete === 'function') {
      await db.shiftExchangeRequest.delete({ where: { id: requestId } });
    } else {
      await db.shiftExchangeRequest.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
    }

    return NextResponse.json({ success: true, message: '調班申請已刪除' });
  } catch (error) {
    console.error('刪除調班申請失敗:', error);
    return NextResponse.json({ error: '刪除調班申請失敗' }, { status: 500 });
  }
}
