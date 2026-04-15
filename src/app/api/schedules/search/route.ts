import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import {
  getManageableDepartments,
  hasFullScheduleManagementAccess
} from '@/lib/schedule-management-permissions';
import { parseIntegerQueryParam } from '@/lib/query-params';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const isFullAdmin = hasFullScheduleManagementAccess(user);
    const manageableDepartments = await getManageableDepartments(user);

    // 非管理員且無管理權限，無法搜尋
    if (!isFullAdmin && manageableDepartments.length === 0) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('yearMonth');
    const employeeId = searchParams.get('employeeId');
    const employeeName = searchParams.get('employeeName');
    const department = searchParams.get('department');
    const position = searchParams.get('position');

    // 構建查詢條件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // 非管理員只能查詢可管理的部門
    if (!isFullAdmin && manageableDepartments.length > 0) {
      where.employee = { department: { in: manageableDepartments } };
    }

    // 按年月份篩選
    if (yearMonth) {
      const [year, month, ...rest] = yearMonth.split('-');
      const yearResult = parseIntegerQueryParam(year, { min: 1900, max: 9999 });
      const monthResult = parseIntegerQueryParam(month, { min: 1, max: 12 });

      if (rest.length > 0 || !yearResult.isValid || !monthResult.isValid || yearResult.value === null || monthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const normalizedYear = String(yearResult.value).padStart(4, '0');
      const normalizedMonth = String(monthResult.value).padStart(2, '0');
      const startDate = `${normalizedYear}-${normalizedMonth}-01`;
      const endDate = `${normalizedYear}-${normalizedMonth}-31`;
      where.workDate = {
        gte: startDate,
        lte: endDate
      };
    }

    // 按部門篩選（管理員可選擇任意部門，非管理員限制在可管理範圍內）
    if (department) {
      if (isFullAdmin || manageableDepartments.includes(department)) {
        where.employee = { ...where.employee, department };
      }
    }

    if (position) {
      where.employee = { ...where.employee, position };
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
