import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';

// 計算用戶可管理的據點列表
async function getManageableLocations(user: { role: string; employeeId?: number }): Promise<string[]> {
  // ADMIN/HR 可管理全部，返回空陣列代表不限
  if (user.role === 'ADMIN' || user.role === 'HR') {
    return [];
  }
  
  if (!user.employeeId) return [];
  
  const locations: string[] = [];
  
  // 1. 部門主管：可管理自己部門
  const managerRecord = await prisma.departmentManager.findFirst({
    where: { employeeId: user.employeeId, isActive: true }
  });
  if (managerRecord) {
    locations.push(managerRecord.department);
  }
  
  // 2. 授權員工：可管理 scheduleManagement 中的據點
  const permRecord = await prisma.attendancePermission.findUnique({
    where: { employeeId: user.employeeId }
  });
  if (permRecord?.permissions) {
    const permissions = permRecord.permissions as { scheduleManagement?: string[] };
    if (Array.isArray(permissions.scheduleManagement)) {
      locations.push(...permissions.scheduleManagement);
    }
  }
  
  return [...new Set(locations)]; // 去重
}

// 檢查員工是否在可管理範圍內
async function canManageEmployee(user: { role: string; employeeId?: number }, targetEmployeeId: number): Promise<boolean> {
  if (user.role === 'ADMIN' || user.role === 'HR') return true;
  
  const manageableLocations = await getManageableLocations(user);
  if (manageableLocations.length === 0 && user.role !== 'ADMIN' && user.role !== 'HR') return false;
  
  // 查詢目標員工的部門
  const targetEmployee = await prisma.employee.findUnique({
    where: { id: targetEmployeeId },
    select: { department: true }
  });
  
  if (!targetEmployee?.department) return false;
  return manageableLocations.includes(targetEmployee.department);
}

// 班表變更後，失效該員工該月的確認
async function invalidateScheduleConfirmation(employeeId: number, workDate: string) {
  try {
    const yearMonth = workDate.substring(0, 7); // 取得 YYYY-MM
    
    // 查詢該月的發布記錄
    const release = await prisma.scheduleMonthlyRelease.findFirst({
      where: { yearMonth, status: 'PUBLISHED' }
    });
    
    if (release) {
      // 更新發布版本並失效確認
      await prisma.scheduleMonthlyRelease.update({
        where: { id: release.id },
        data: {
          version: { increment: 1 },
          lastModified: new Date()
        }
      });
      
      // 將該員工的確認標記為無效
      await prisma.scheduleConfirmation.updateMany({
        where: {
          employeeId,
          releaseId: release.id,
          isValid: true
        },
        data: { isValid: false }
      });
    }
  } catch (error) {
    console.error('失效班表確認失敗:', error);
    // 不拋出錯誤，讓主要操作繼續
  }
}

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
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    const scheduleId = parseInt(id);

    if (isNaN(scheduleId)) {
      return NextResponse.json({ error: 'Invalid schedule ID' }, { status: 400 });
    }

    // 查詢要更新的排程
    const scheduleToUpdate = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      select: { employeeId: true }
    });

    if (!scheduleToUpdate) {
      return NextResponse.json({ error: '找不到排程' }, { status: 404 });
    }

    // 權限檢查：確認有權限管理該員工
    const canManage = await canManageEmployee(user, scheduleToUpdate.employeeId);
    if (!canManage) {
      return NextResponse.json({ error: '無權限管理該員工的排程' }, { status: 403 });
    }

    const body = await request.json();
    const { startTime, endTime, shiftType, workDate } = body;

    // 非工作班別（NH/RD/rd/FDL/TD）應強制清空時間
    const noTimeShiftTypes = ['NH', 'RD', 'rd', 'FDL', 'TD'];
    const shouldClearTime = shiftType && noTimeShiftTypes.includes(shiftType);

    // 建立更新資料
    const updateData: {
      startTime?: string;
      endTime?: string;
      shiftType?: string;
      workDate?: string;
    } = {};

    if (shiftType) {
      updateData.shiftType = shiftType;
    }
    if (workDate) {
      updateData.workDate = workDate;
    }

    // 處理時間欄位：非工作班別強制清空，否則按傳入值更新
    if (shouldClearTime) {
      updateData.startTime = '';
      updateData.endTime = '';
    } else {
      if (startTime !== undefined) {
        updateData.startTime = startTime;
      }
      if (endTime !== undefined) {
        updateData.endTime = endTime;
      }
    }

    const updatedSchedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: updateData,
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

    // 觸發重新確認機制
    await invalidateScheduleConfirmation(updatedSchedule.employeeId, updatedSchedule.workDate);

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
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    const scheduleId = parseInt(id);

    if (isNaN(scheduleId)) {
      return NextResponse.json({ error: 'Invalid schedule ID' }, { status: 400 });
    }

    // 先查詢班表資訊以便觸發重新確認和權限檢查
    const scheduleToDelete = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      select: { employeeId: true, workDate: true }
    });

    if (!scheduleToDelete) {
      return NextResponse.json({ error: '找不到排程' }, { status: 404 });
    }

    // 權限檢查：確認有權限管理該員工
    const canManage = await canManageEmployee(user, scheduleToDelete.employeeId);
    if (!canManage) {
      return NextResponse.json({ error: '無權限管理該員工的排程' }, { status: 403 });
    }

    await prisma.schedule.delete({
      where: { id: scheduleId }
    });

    // 觸發重新確認機制
    if (scheduleToDelete) {
      await invalidateScheduleConfirmation(scheduleToDelete.employeeId, scheduleToDelete.workDate);
    }

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
