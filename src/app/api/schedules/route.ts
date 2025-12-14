import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';

// GET: 取得排程列表
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Authentication check
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const department = searchParams.get('department');
    const employeeId = searchParams.get('employeeId');

    // 構建查詢條件
    const where: Record<string, unknown> = {};

    // 日期篩選
    if (date) {
      where.workDate = date;
    } else if (startDate || endDate) {
      where.workDate = {};
      if (startDate) {
        (where.workDate as Record<string, string>).gte = startDate;
      }
      if (endDate) {
        (where.workDate as Record<string, string>).lte = endDate;
      }
    }

    // 部門篩選
    if (department) {
      where.employee = { department };
    }

    // 員工篩選
    if (employeeId) {
      where.employeeId = parseInt(employeeId);
    }

    // 非管理員只能查看自己的班表
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      where.employeeId = user.employeeId;
    }

    // 查詢班表
    const schedules = await prisma.schedule.findMany({
      where,
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
      },
      orderBy: [
        { workDate: 'asc' },
        { startTime: 'asc' }
      ]
    });

    // 格式化輸出
    const formattedSchedules = schedules.map(s => ({
      id: s.id,
      employeeId: s.employee.employeeId,
      employeeName: s.employee.name,
      department: s.employee.department,
      date: s.workDate,
      startTime: s.startTime,
      endTime: s.endTime,
      shiftType: s.shiftType,
      status: 'active',
      employee: s.employee
    }));

    return NextResponse.json({
      success: true,
      schedules: formattedSchedules,
      total: formattedSchedules.length
    });
  } catch (error) {
    console.error('取得排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// POST: 新增排程
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    // Authentication check
    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, date, startTime, endTime, shiftType = 'normal' } = body;

    if (!employeeId || !date || !startTime || !endTime) {
      return NextResponse.json(
        { success: false, error: '員工ID、日期、開始時間和結束時間為必填項目' },
        { status: 400 }
      );
    }

    // 查找員工
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { id: typeof employeeId === 'number' ? employeeId : undefined },
          { employeeId: typeof employeeId === 'string' ? employeeId : undefined }
        ]
      }
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: '找不到該員工' },
        { status: 404 }
      );
    }

    // 檢查是否已有相同員工在相同日期的排程
    const existingSchedule = await prisma.schedule.findUnique({
      where: {
        employeeId_workDate: {
          employeeId: employee.id,
          workDate: date
        }
      }
    });

    if (existingSchedule) {
      return NextResponse.json(
        { success: false, error: '該員工在此日期已有排程' },
        { status: 400 }
      );
    }

    // 新增排程
    const newSchedule = await prisma.schedule.create({
      data: {
        employeeId: employee.id,
        workDate: date,
        startTime,
        endTime,
        shiftType
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: '排程新增成功',
      schedule: {
        id: newSchedule.id,
        employeeId: newSchedule.employee.employeeId,
        employeeName: newSchedule.employee.name,
        department: newSchedule.employee.department,
        date: newSchedule.workDate,
        startTime: newSchedule.startTime,
        endTime: newSchedule.endTime,
        shiftType: newSchedule.shiftType,
        status: 'active'
      }
    }, { status: 201 });
  } catch (error) {
    console.error('新增排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// PUT: 更新排程
export async function PUT(request: NextRequest) {
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

    const body = await request.json();
    const { id, startTime, endTime, shiftType } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: '排程ID為必填' },
        { status: 400 }
      );
    }

    const updatedSchedule = await prisma.schedule.update({
      where: { id },
      data: {
        ...(startTime && { startTime }),
        ...(endTime && { endTime }),
        ...(shiftType && { shiftType })
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
      schedule: updatedSchedule
    });
  } catch (error) {
    console.error('更新排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// DELETE: 刪除排程
export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '排程ID為必填' },
        { status: 400 }
      );
    }

    await prisma.schedule.delete({
      where: { id: parseInt(id) }
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