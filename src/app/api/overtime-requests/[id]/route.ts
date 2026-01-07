import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { notifyOvertimeApproval } from '@/lib/email';
import { calculateOvertimePayForRequest, OvertimeType } from '@/lib/salary-utils';

// 審核或編輯加班申請
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
    const overtimeRequestId = parseInt(id);

    // 查找加班申請
    const existing = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeRequestId },
      include: { employee: true }
    });

    if (!existing) {
      return NextResponse.json({ error: '找不到加班申請' }, { status: 404 });
    }

    const body = await request.json();

    // 若傳入 status 或 opinion，視為審核
    if (typeof body.status === 'string' || typeof body.opinion === 'string') {
      // 主管審核（提供意見，轉交 Admin）
      if (decoded.role === 'MANAGER' && existing.status === 'PENDING') {
        const opinion = body.opinion as 'AGREE' | 'DISAGREE';
        if (!['AGREE', 'DISAGREE'].includes(opinion)) {
          return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
        }

        await prisma.overtimeRequest.update({
          where: { id: overtimeRequestId },
          data: {
            status: 'PENDING_ADMIN',
            managerReviewerId: decoded.employeeId,
            managerOpinion: opinion,
            managerNote: body.note || null,
            managerReviewedAt: new Date()
          }
        });

        // TODO: 發送 CC 通知給 HR

        return NextResponse.json({
          success: true,
          message: '主管審核完成，已轉交管理員決核'
        });
      }

      // Admin 最終決核
      if (decoded.role === 'ADMIN') {
        const { status } = body as { status: 'APPROVED' | 'REJECTED' };

        if (!['APPROVED', 'REJECTED'].includes(status)) {
          return NextResponse.json({ error: '無效的審核狀態' }, { status: 400 });
        }

        // Admin 可以審核 PENDING 或 PENDING_ADMIN 狀態
        if (existing.status !== 'PENDING' && existing.status !== 'PENDING_ADMIN') {
          return NextResponse.json({ error: '該加班申請已經被審核過' }, { status: 400 });
        }

        // 如果選擇加班費，計算加班費金額
        let overtimePay: number | null = null;
        let hourlyRateUsed: number | null = null;
        let overtimeType: OvertimeType = 'WEEKDAY';

        if (status === 'APPROVED' && existing.compensationType === 'OVERTIME_PAY') {
          overtimeType = (body.overtimeType as OvertimeType) || 'WEEKDAY';
          
          const payResult = await calculateOvertimePayForRequest(
            existing.employeeId,
            existing.overtimeDate,
            existing.totalHours,
            overtimeType
          );

          if (payResult.success) {
            overtimePay = payResult.overtimePay || null;
            hourlyRateUsed = payResult.hourlyRate || null;
          } else {
            console.error('計算加班費失敗:', payResult.error);
          }
        }

        const updatedOvertimeRequest = await prisma.overtimeRequest.update({
          where: { id: overtimeRequestId },
          data: {
            status,
            approvedBy: decoded.employeeId,
            approvedAt: new Date(),
            overtimeType: overtimeType || undefined,
            overtimePay: overtimePay || undefined,
            hourlyRateUsed: hourlyRateUsed || undefined
          },
          include: {
            employee: {
              select: { id: true, employeeId: true, name: true, department: true, position: true }
            }
          }
        });

        // 審核通過時，累積補休時數
        if (status === 'APPROVED' && existing.compensationType === 'COMP_LEAVE') {
          const overtimeDate = new Date(existing.overtimeDate);
          const yearMonth = `${overtimeDate.getFullYear()}-${String(overtimeDate.getMonth() + 1).padStart(2, '0')}`;
          
          await prisma.compLeaveTransaction.create({
            data: {
              employeeId: existing.employeeId,
              transactionType: 'EARN',
              hours: existing.totalHours,
              referenceId: overtimeRequestId,
              referenceType: 'OVERTIME',
              yearMonth,
              description: `加班審核通過 - ${existing.reason}`,
              isFrozen: false
            }
          });

          await prisma.compLeaveBalance.upsert({
            where: { employeeId: existing.employeeId },
            update: {
              pendingEarn: { increment: existing.totalHours }
            },
            create: {
              employeeId: existing.employeeId,
              pendingEarn: existing.totalHours
            }
          });
        }

        // 發送審核結果通知
        try {
          await notifyOvertimeApproval({
            employeeId: existing.employeeId,
            employeeName: existing.employee.name,
            employeeEmail: existing.employee.email || undefined,
            approved: status === 'APPROVED',
            overtimeDate: existing.overtimeDate.toISOString().split('T')[0],
            hours: existing.totalHours,
            reason: body.rejectionReason,
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

      // HR 不能直接審核
      return NextResponse.json({ error: '無權限執行此操作，加班需由主管審核後由管理員決核' }, { status: 403 });
    }

    // 否則視為「編輯」：申請人自己或管理員/HR可在待審核狀態下修改
    if (existing.status !== 'PENDING') {
      return NextResponse.json({ error: '僅能修改待審核的申請' }, { status: 400 });
    }

    if (existing.employeeId !== decoded.employeeId && decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限修改此申請' }, { status: 403 });
    }

    const { overtimeDate, startTime, endTime, reason, workContent } = body as Partial<{
      overtimeDate: string;
      startTime: string;
      endTime: string;
      reason: string;
      workContent: string;
    }>;

    // 驗證變更（若提供）
    if (startTime) {
      const [startHour] = startTime.split(':').map(Number);
      if (startHour < 17) {
        return NextResponse.json({ error: '加班開始時間必須在17:00之後（正常工作8小時後）' }, { status: 400 });
      }
    }

    // 計算時數（若提供了時間）
    function calculateOvertimeHours(st: string, et: string): number {
      const [sh, sm] = st.split(':').map(Number);
      const [eh, em] = et.split(':').map(Number);
      let minutes = (eh * 60 + em) - (sh * 60 + sm);
      if (minutes < 0) minutes += 24 * 60;
      const hours = minutes / 60;
      return Math.ceil(hours * 2) / 2; // 0.5 單位進位
    }

    let totalHours: number | undefined = existing.totalHours;
    if (startTime && endTime) {
      totalHours = calculateOvertimeHours(startTime, endTime);
      if (totalHours < 0.5) {
        return NextResponse.json({ error: '加班時數最少0.5小時' }, { status: 400 });
      }
      if (totalHours > 4) {
        return NextResponse.json({ error: '單日加班時數不能超過4小時' }, { status: 400 });
      }
      if ((8 + totalHours) > 12) {
        return NextResponse.json({ error: '一天工作時間不能超過12小時' }, { status: 400 });
      }
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
    const overtimeRequestId = parseInt(id);

    // 查找加班申請
    const overtimeRequest = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeRequestId }
    });

    if (!overtimeRequest) {
      return NextResponse.json({ error: '找不到加班申請' }, { status: 404 });
    }

    // 只有申請人或管理員可以刪除
    if (overtimeRequest.employeeId !== decoded.employeeId && 
        decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
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
