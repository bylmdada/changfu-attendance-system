import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// POST - 批次審核忘打卡申請
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

    const user = getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { ids, action, remarks } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: '無效的審核操作' }, { status: 400 });
    }

    // 獲取待審核的申請
    const pendingRequests = await prisma.missedClockRequest.findMany({
      where: {
        id: { in: ids.map((id: number | string) => parseInt(String(id))) },
        status: 'PENDING'
      }
    });

    let updatedCount = 0;

    // 逐一處理（因為批准時需要更新考勤記錄）
    for (const req of pendingRequests) {
      await prisma.missedClockRequest.update({
        where: { id: req.id },
        data: {
          status: action,
          approvedBy: user.userId,
          approvedAt: new Date(),
          rejectReason: action === 'REJECTED' ? remarks : null
        }
      });

      // 如果批准，更新考勤記錄
      if (action === 'APPROVED') {
        const existingAttendance = await prisma.attendanceRecord.findFirst({
          where: {
            employeeId: req.employeeId,
            workDate: new Date(req.workDate)
          }
        });

        if (existingAttendance) {
          const updateData: { clockInTime?: string; clockOutTime?: string } = {};
          if (req.clockType === 'CLOCK_IN') {
            updateData.clockInTime = req.requestedTime;
          } else {
            updateData.clockOutTime = req.requestedTime;
          }
          
          await prisma.attendanceRecord.update({
            where: { id: existingAttendance.id },
            data: updateData
          });
        } else {
          const createData: {
            employeeId: number;
            workDate: Date;
            status: string;
            clockInTime?: string;
            clockOutTime?: string;
          } = {
            employeeId: req.employeeId,
            workDate: new Date(req.workDate),
            status: 'PRESENT'
          };
          
          if (req.clockType === 'CLOCK_IN') {
            createData.clockInTime = req.requestedTime;
          } else {
            createData.clockOutTime = req.requestedTime;
          }
          
          await prisma.attendanceRecord.create({ data: createData });
        }
      }

      updatedCount++;
    }

    return NextResponse.json({
      success: true,
      message: `已${action === 'APPROVED' ? '批准' : '拒絕'} ${updatedCount} 筆忘打卡申請`,
      count: updatedCount
    });
  } catch (error) {
    console.error('批次審核忘打卡申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
