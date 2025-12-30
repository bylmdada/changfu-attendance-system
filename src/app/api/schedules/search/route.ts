import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

// 計算用戶可管理的據點列表
async function getManageableLocations(user: { role: string; employeeId?: number }): Promise<string[]> {
  if (user.role === 'ADMIN' || user.role === 'HR') {
    return []; // 空陣列代表不限
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
  
  return [...new Set(locations)];
}

export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const isFullAdmin = user.role === 'ADMIN' || user.role === 'HR';
    const manageableLocations = await getManageableLocations(user);

    // 非管理員且無管理權限，無法搜尋
    if (!isFullAdmin && manageableLocations.length === 0) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('yearMonth');
    const employeeId = searchParams.get('employeeId');
    const employeeName = searchParams.get('employeeName');
    const department = searchParams.get('department');

    // 構建查詢條件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // 非管理員只能查詢可管理的部門
    if (!isFullAdmin && manageableLocations.length > 0) {
      where.employee = { department: { in: manageableLocations } };
    }

    // 按年月份篩選
    if (yearMonth) {
      const [year, month] = yearMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = `${year}-${month}-31`;
      where.workDate = {
        gte: startDate,
        lte: endDate
      };
    }

    // 按部門篩選（管理員可選擇任意部門，非管理員限制在可管理範圍內）
    if (department) {
      if (isFullAdmin || manageableLocations.includes(department)) {
        where.employee = { ...where.employee, department };
      }
    }

    // 按員編或姓名篩選
    if (employeeId || employeeName) {
      const employeeFilter: Record<string, unknown> = {};
      if (employeeId) {
        employeeFilter.employeeId = { contains: employeeId };
      }
      if (employeeName) {
        employeeFilter.name = { contains: employeeName };
      }
      where.employee = { ...where.employee, ...employeeFilter };
    }

    // 從資料庫查詢
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
      orderBy: { workDate: 'asc' }
    });

    return NextResponse.json({
      success: true,
      schedules: schedules.map(s => ({
        id: s.id,
        employeeId: s.employeeId,
        workDate: s.workDate,
        shiftType: s.shiftType,
        startTime: s.startTime,
        endTime: s.endTime,
        employee: s.employee
      }))
    });

  } catch (error) {
    console.error('搜尋班表失敗:', error);
    return NextResponse.json(
      { error: '搜尋班表失敗' },
      { status: 500 }
    );
  }
}
