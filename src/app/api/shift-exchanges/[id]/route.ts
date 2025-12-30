import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';

interface EmployeeLite { id: number; employeeId: string; name: string; position: string; department?: string }
interface ShiftExchangeLite {
  id: number;
  requesterId: number;
  targetEmployeeId: number;
  originalWorkDate: string;
  targetWorkDate: string;
  requestReason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
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

const db = prisma as unknown as PrismaShiftExchangeClient;

// 小工具：依班別給出時段
function getTemplateByShift(shift: string): { startTime: string; endTime: string } {
  const map: Record<string, { startTime: string; endTime: string }> = {
    A: { startTime: '07:30', endTime: '16:30' },
    B: { startTime: '08:00', endTime: '17:00' },
    C: { startTime: '08:30', endTime: '17:30' },
  };
  return map[shift] || { startTime: '', endTime: '' };
}

// PATCH - 審核調班申請（批准/拒絕）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const body = await request.json();
    const { action: rawAction, remarks, status } = body as { action?: string; remarks?: string; status?: string };

    // 兼容舊前端：若傳入 status，映射為 action（僅管理員/HR才能審核）
    let action = rawAction as 'approve' | 'reject' | undefined;
    if (!action && status) {
      if (String(status).toUpperCase() === 'APPROVED') action = 'approve';
      if (String(status).toUpperCase() === 'REJECTED') action = 'reject';
    }

    const { id } = await params;
    const requestId = parseInt(id);

    if (!db.shiftExchangeRequest || typeof db.shiftExchangeRequest.findUnique !== 'function') {
      return NextResponse.json({ error: '功能暫不可用' }, { status: 503 });
    }

    const current = await db.shiftExchangeRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true } },
        targetEmployee: { select: { id: true } }
      }
    });

    if (!current) {
      return NextResponse.json({ error: '調班申請不存在' }, { status: 404 });
    }

    // 如果是審核流程
    if (action) {
      if (user.role !== 'ADMIN' && user.role !== 'HR') {
        return NextResponse.json({ error: '權限不足' }, { status: 403 });
      }
      if (current.status !== 'PENDING') {
        return NextResponse.json({ error: '此申請已被處理' }, { status: 400 });
      }

      // 核准時檢查凍結狀態
      if (action === 'approve') {
        const originalDateObj = new Date(current.originalWorkDate);
        const freezeCheck = await checkAttendanceFreeze(originalDateObj);
        if (freezeCheck.isFrozen) {
          const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW');
          return NextResponse.json({
            error: `該月份已被凍結，無法核准調班申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
          }, { status: 403 });
        }

        // 互調班時也檢查目標日期
        if (current.originalWorkDate !== current.targetWorkDate) {
          const targetDateObj = new Date(current.targetWorkDate);
          const targetFreezeCheck = await checkAttendanceFreeze(targetDateObj);
          if (targetFreezeCheck.isFrozen) {
            const freezeDateStr = targetFreezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW');
            return NextResponse.json({
              error: `目標月份已被凍結，無法核准調班申請。凍結時間：${freezeDateStr}，操作者：${targetFreezeCheck.freezeInfo?.creator.name}`
            }, { status: 403 });
          }
        }
      }

      const now = new Date();
      const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

      const updatedRequest = await db.shiftExchangeRequest.update({
        where: { id: requestId },
        data: {
          status: newStatus,
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

      // 現有的排班調整邏輯（自調與互換）保持不變
      if (action === 'approve') {
        if (!db.$transaction || !db.schedule) {
          return NextResponse.json(updatedRequest);
        }
        // 嘗試解析是否為自調班
        let parsed: SelfChangePayload | null = null;
        try { parsed = JSON.parse(current.requestReason) as SelfChangePayload; } catch {}
        const isSelfChange = parsed && parsed.type === 'SELF_CHANGE';

        await db.$transaction(async (tx) => {
          if (isSelfChange) {
            const date = current.originalWorkDate;
            const newShift: string = parsed?.new || 'A';
            const t = getTemplateByShift(newShift);
            const original = await tx.schedule!.findFirst({
              where: { employeeId: current.requesterId, workDate: date }
            });
            if (original) {
              await tx.schedule!.update({
                where: { id: original.id },
                data: { shiftType: newShift, startTime: t.startTime, endTime: t.endTime }
              });
            }
            return;
          }

          const [originalSchedule, targetSchedule] = await Promise.all([
            tx.schedule!.findFirst({ where: { employeeId: current.requesterId, workDate: current.originalWorkDate } }),
            tx.schedule!.findFirst({ where: { employeeId: current.targetEmployeeId, workDate: current.targetWorkDate } })
          ]);

          if (originalSchedule && targetSchedule) {
            const temp = { shiftType: originalSchedule.shiftType, startTime: originalSchedule.startTime, endTime: originalSchedule.endTime };
            await tx.schedule!.update({ where: { id: originalSchedule.id }, data: { shiftType: targetSchedule.shiftType, startTime: targetSchedule.startTime, endTime: targetSchedule.endTime } });
            await tx.schedule!.update({ where: { id: targetSchedule.id }, data: { shiftType: temp.shiftType, startTime: temp.startTime, endTime: temp.endTime } });
          }
        });
      }

      return NextResponse.json(updatedRequest);
    }

    // 否則視為編輯：僅申請者本人或管理員/HR，且僅限 PENDING
    if (current.status !== 'PENDING') {
      return NextResponse.json({ error: '僅能修改待審核的申請' }, { status: 400 });
    }
    const isOwner = user.employeeId === current.requesterId;
    if (!isOwner && user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限修改此申請' }, { status: 403 });
    }

    // 支援兩種編輯負載
    const isSelfChangeEdit = !!body.shiftDate || (() => { try { const p = JSON.parse(current.requestReason); return p?.type === 'SELF_CHANGE'; } catch { return false; } })();

    let dataToUpdate: Record<string, unknown> = {};

    if (isSelfChangeEdit) {
      const shiftDate = body.shiftDate ?? current.originalWorkDate;
      const original = body.originalShiftType ?? (() => { try { return JSON.parse(current.requestReason)?.original; } catch { return undefined; } })() ?? 'A';
      const next = body.newShiftType ?? (() => { try { return JSON.parse(current.requestReason)?.new; } catch { return undefined; } })() ?? 'A';
      const note = body.reason ?? (() => { try { return JSON.parse(current.requestReason)?.note; } catch { return undefined; } })() ?? '';
      dataToUpdate = {
        originalWorkDate: String(shiftDate),
        targetWorkDate: String(shiftDate),
        requestReason: JSON.stringify({ type: 'SELF_CHANGE', shiftDate: String(shiftDate), original, new: next, note })
      };
    } else {
      // 互換班編輯
      dataToUpdate = {
        targetEmployeeId: body.targetEmployeeId ? parseInt(String(body.targetEmployeeId)) : current.targetEmployeeId,
        originalWorkDate: body.originalWorkDate ?? current.originalWorkDate,
        targetWorkDate: body.targetWorkDate ?? current.targetWorkDate,
        requestReason: body.requestReason ?? current.requestReason
      };
    }

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
    const user = getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: '未授權' }, { status: 401 });

    if (!db.shiftExchangeRequest) return NextResponse.json({ error: '功能暫不可用' }, { status: 503 });

    const { id } = await params;
    const requestId = parseInt(id);
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

interface SelfChangePayload { type: 'SELF_CHANGE'; shiftDate?: string; original?: string; new?: string; note?: string }
