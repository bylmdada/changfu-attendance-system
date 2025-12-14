import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';

// 窄化型別，避免直接耦合
interface PrismaWithSchedule {
  schedule?: {
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>
  }
}
const db = prisma as unknown as PrismaWithSchedule;

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { id } = await params;
    const leaveRequestId = parseInt(id);

    // 查找請假申請
    const existing = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { employee: true }
    });

    if (!existing) {
      return NextResponse.json({ error: '找不到請假申請' }, { status: 404 });
    }

    const body = await request.json();

    // 若傳入 status，視為審核（僅 ADMIN/HR）
    if (typeof body.status === 'string') {
      if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
        return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
      }

      const status = body.status as 'APPROVED' | 'REJECTED';
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        return NextResponse.json({ error: '無效的審核狀態' }, { status: 400 });
      }

      if (existing.status !== 'PENDING') {
        return NextResponse.json({ error: '該請假申請已經被審核過' }, { status: 400 });
      }

      const updatedLeaveRequest = await prisma.leaveRequest.update({
        where: { id: leaveRequestId },
        data: {
          status,
          approvedBy: decoded.employeeId,
          approvedAt: new Date()
        },
        include: {
          employee: {
            select: { id: true, employeeId: true, name: true, department: true, position: true }
          }
        }
      });

      // 若批准，更新班表為請假（FDL）
      if (status === 'APPROVED' && db.schedule) {
        const empId = existing.employeeId;
        // 以天為單位更新
        const start = new Date(existing.startDate);
        const end = new Date(existing.endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const ymd = toYmd(d);
          await db.schedule.updateMany({
            where: { employeeId: empId, workDate: ymd },
            data: { shiftType: 'FDL', startTime: '', endTime: '' }
          });
        }
      }

      return NextResponse.json({
        success: true,
        leaveRequest: updatedLeaveRequest,
        message: status === 'APPROVED' ? '請假申請已批准' : '請假申請已拒絕'
      });
    }

    // 否則視為「編輯」：申請人自己或管理員/HR可在待審核狀態下修改
    if (existing.status !== 'PENDING') {
      return NextResponse.json({ error: '僅能修改待審核的申請' }, { status: 400 });
    }

    if (existing.employeeId !== decoded.employeeId && decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限修改此申請' }, { status: 403 });
    }

    const { leaveType, startDate, endDate, reason, startHour, startMinute, endHour, endMinute } = body as Partial<{
      leaveType: string;
      startDate: string;
      endDate: string;
      reason: string;
      startHour: string; startMinute: string; endHour: string; endMinute: string;
    }>;

    // 驗證與計算 totalDays
    let nextStart: Date | undefined;
    let nextEnd: Date | undefined;
    let nextTotalDays: number | undefined;

    const hasTime = startHour !== undefined && startMinute !== undefined && endHour !== undefined && endMinute !== undefined;
    if (hasTime && startDate && endDate) {
      // 分鐘 0..59，且 30 分鐘倍數
      const sm = Number(startMinute);
      const em = Number(endMinute);
      const sh = Number(startHour);
      const eh = Number(endHour);
      if ([sm, em, sh, eh].some(n => Number.isNaN(n))) {
        return NextResponse.json({ error: '請輸入有效的起訖時間' }, { status: 400 });
      }
      if (sm < 0 || sm > 59 || em < 0 || em > 59) {
        return NextResponse.json({ error: '分鐘僅允許 0 ~ 59' }, { status: 400 });
      }
      const s = new Date(`${startDate}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`);
      const e = new Date(`${endDate}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`);
      const diffMin = Math.round((e.getTime() - s.getTime()) / 60000);
      if (diffMin <= 0) {
        return NextResponse.json({ error: '請假時數必須為正數' }, { status: 400 });
      }
      if (diffMin % 30 !== 0) {
        return NextResponse.json({ error: '請假時數需以 0.5 小時為增量（30 分鐘）' }, { status: 400 });
      }
      nextStart = s; nextEnd = e;
      nextTotalDays = (diffMin / 60) / 8;
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

    const updated = await prisma.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        leaveType: leaveType ?? undefined,
        startDate: nextStart ?? undefined,
        endDate: nextEnd ?? undefined,
        totalDays: nextTotalDays ?? undefined,
        reason: reason ?? undefined
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
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { id } = await params;
    const leaveRequestId = parseInt(id);

    // 查找請假申請
    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId }
    });

    if (!leaveRequest) {
      return NextResponse.json({ error: '找不到請假申請' }, { status: 404 });
    }

    // 只有申請人或管理員可以刪除
    if (leaveRequest.employeeId !== decoded.employeeId && 
        decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
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
