import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

// POST - 提交打卡原因
export async function POST(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { recordId, clockType, reason, overtimeId, newOvertimeRequest } = await request.json();

    if (!recordId || !clockType || !reason) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (!['in', 'out'].includes(clockType)) {
      return NextResponse.json({ error: '無效的打卡類型' }, { status: 400 });
    }

    if (!['PERSONAL', 'BUSINESS'].includes(reason)) {
      return NextResponse.json({ error: '無效的原因類型' }, { status: 400 });
    }

    // 查詢考勤記錄
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { employee: true }
    });

    if (!record) {
      return NextResponse.json({ error: '考勤記錄不存在' }, { status: 404 });
    }

    // 確保只能更新自己的記錄（除非是管理員）
    const employeeUserId = await prisma.user.findFirst({
      where: { employeeId: record.employeeId },
      select: { id: true }
    });
    if (employeeUserId?.id !== user.userId && user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限修改此記錄' }, { status: 403 });
    }

    let linkedOvertimeId = overtimeId;

    // 如果選擇公務且需要快速申請加班
    if (reason === 'BUSINESS' && newOvertimeRequest) {
      const { startTime, endTime, hours, overtimeReason } = newOvertimeRequest;
      
      // 建立加班申請
      const newOvertime = await prisma.overtimeRequest.create({
        data: {
          employeeId: record.employeeId,
          overtimeDate: record.workDate,
          startTime: startTime, // String format "HH:mm"
          endTime: endTime,     // String format "HH:mm"
          totalHours: hours || 0,
          reason: overtimeReason || (clockType === 'in' ? '提早上班工作' : '延後下班工作'),
          status: 'PENDING'
        }
      });

      linkedOvertimeId = newOvertime.id;
    }

    // 更新考勤記錄
    const updateData: Record<string, unknown> = {};
    if (clockType === 'in') {
      updateData.clockInReason = reason;
      if (linkedOvertimeId) updateData.clockInOvertimeId = linkedOvertimeId;
    } else {
      updateData.clockOutReason = reason;
      if (linkedOvertimeId) updateData.clockOutOvertimeId = linkedOvertimeId;
    }

    await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: updateData
    });

    return NextResponse.json({ 
      success: true, 
      message: reason === 'BUSINESS' ? '已記錄為公務' : '已記錄為非公務',
      overtimeId: linkedOvertimeId
    });
  } catch (error) {
    console.error('提交打卡原因失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
