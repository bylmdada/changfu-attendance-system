import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';

// GET: 取得單一排程
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    const scheduleId = parseInt(id);

    if (isNaN(scheduleId)) {
      return NextResponse.json({ error: 'Invalid schedule ID' }, { status: 400 });
    }

    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      }
    });

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    // 非管理員只能查看自己的班表
    if (user.role !== 'ADMIN' && schedule.employeeId !== user.employeeId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      schedule: {
        id: schedule.id,
        employeeId: schedule.employee.employeeId,
        employeeName: schedule.employee.name,
        department: schedule.employee.department,
        date: schedule.workDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        shiftType: schedule.shiftType,
        status: 'active',
        employee: schedule.employee
      }
    });
  } catch (error) {
    console.error('取得排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// PUT: 更新單一排程
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const scheduleId = parseInt(id);

    if (isNaN(scheduleId)) {
      return NextResponse.json({ error: 'Invalid schedule ID' }, { status: 400 });
    }

    const body = await request.json();
    const { startTime, endTime, shiftType, workDate } = body;

    const updatedSchedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        ...(startTime && { startTime }),
        ...(endTime && { endTime }),
        ...(shiftType && { shiftType }),
        ...(workDate && { workDate })
      },
      include: {
        employee: {
          select: {
            employeeId: true,
            name: true,
            department: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: '排程更新成功',
      schedule: {
        id: updatedSchedule.id,
        employeeId: updatedSchedule.employee.employeeId,
        employeeName: updatedSchedule.employee.name,
        department: updatedSchedule.employee.department,
        date: updatedSchedule.workDate,
        startTime: updatedSchedule.startTime,
        endTime: updatedSchedule.endTime,
        shiftType: updatedSchedule.shiftType
      }
    });
  } catch (error) {
    console.error('更新排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// DELETE: 刪除單一排程
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const scheduleId = parseInt(id);

    if (isNaN(scheduleId)) {
      return NextResponse.json({ error: 'Invalid schedule ID' }, { status: 400 });
    }

    await prisma.schedule.delete({
      where: { id: scheduleId }
    });

    return NextResponse.json({
      success: true,
      message: '排程刪除成功'
    });
  } catch (error) {
    console.error('刪除排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}
