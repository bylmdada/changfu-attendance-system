import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

function validateIntegerQueryParam(
  value: string | null,
  fieldName: string,
  options: { min?: number; max?: number; optional?: boolean } = {}
) {
  if (value === null) {
    return { value: null as number | null, error: options.optional ? null : `缺少${fieldName}參數` };
  }

  if (!/^\d+$/.test(value)) {
    return { value: null as number | null, error: `無效的${fieldName}參數` };
  }

  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue)) {
    return { value: null as number | null, error: `無效的${fieldName}參數` };
  }

  if (
    (options.min !== undefined && parsedValue < options.min) ||
    (options.max !== undefined && parsedValue > options.max)
  ) {
    return { value: null as number | null, error: `無效的${fieldName}參數` };
  }

  return { value: parsedValue, error: null };
}

// GET - 取得加班時數統計
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearResult = validateIntegerQueryParam(searchParams.get('year'), '年份', {
      min: 1900,
      max: 9999,
      optional: true,
    });
    if (yearResult.error) {
      return NextResponse.json({ error: yearResult.error }, { status: 400 });
    }

    const monthResult = validateIntegerQueryParam(searchParams.get('month'), '月份', {
      min: 1,
      max: 12,
      optional: true,
    });
    if (monthResult.error) {
      return NextResponse.json({ error: monthResult.error }, { status: 400 });
    }

    const employeeIdResult = validateIntegerQueryParam(searchParams.get('employeeId'), '員工編號', {
      min: 1,
      optional: true,
    });
    if (employeeIdResult.error) {
      return NextResponse.json({ error: employeeIdResult.error }, { status: 400 });
    }

    const department = searchParams.get('department');

    const now = new Date();
    const year = yearResult.value ?? now.getFullYear();

    // 建立查詢條件
    const whereClause: {
      status: string;
      overtimeDate?: { gte: Date; lte: Date };
      employee?: { department?: string; id?: number };
    } = {
      status: 'APPROVED'
    };

    // 月度或年度範圍
    if (monthResult.value !== null) {
      const month = monthResult.value;
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      whereClause.overtimeDate = { gte: startDate, lte: endDate };
    } else {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31, 23, 59, 59);
      whereClause.overtimeDate = { gte: startDate, lte: endDate };
    }

    // 部門/員工篩選
    if (department || employeeIdResult.value !== null) {
      whereClause.employee = {};
      if (department) whereClause.employee.department = department;
      if (employeeIdResult.value !== null) whereClause.employee.id = employeeIdResult.value;
    }

    // 取得加班記錄
    const overtimeRequests = await prisma.overtimeRequest.findMany({
      where: whereClause,
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
      orderBy: { overtimeDate: 'asc' }
    });

    // ==================== 統計計算 ====================

    // 1. 依員工彙總
    const employeeStats: Record<number, {
      employee: typeof overtimeRequests[0]['employee'];
      totalHours: number;
      requestCount: number;
    }> = {};

    // 2. 依部門彙總
    const departmentStats: Record<string, {
      department: string;
      totalHours: number;
      employeeCount: Set<number>;
      requestCount: number;
    }> = {};

    // 3. 月度趨勢（年度查詢時）
    const monthlyTrend: Record<number, {
      month: number;
      totalHours: number;
      requestCount: number;
    }> = {};

    for (let m = 1; m <= 12; m++) {
      monthlyTrend[m] = { month: m, totalHours: 0, requestCount: 0 };
    }

    for (const overtime of overtimeRequests) {
      const empId = overtime.employeeId;
      const dept = overtime.employee.department || '未指定部門';
      const month = new Date(overtime.overtimeDate).getMonth() + 1;

      // 員工統計
      if (!employeeStats[empId]) {
        employeeStats[empId] = {
          employee: overtime.employee,
          totalHours: 0,
          requestCount: 0
        };
      }
      employeeStats[empId].totalHours += overtime.totalHours;
      employeeStats[empId].requestCount += 1;

      // 部門統計
      if (!departmentStats[dept]) {
        departmentStats[dept] = {
          department: dept,
          totalHours: 0,
          employeeCount: new Set(),
          requestCount: 0
        };
      }
      departmentStats[dept].totalHours += overtime.totalHours;
      departmentStats[dept].employeeCount.add(empId);
      departmentStats[dept].requestCount += 1;

      // 月度趨勢
      monthlyTrend[month].totalHours += overtime.totalHours;
      monthlyTrend[month].requestCount += 1;
    }

    // 整理輸出格式
    const employeeStatsArray = Object.values(employeeStats)
      .sort((a, b) => b.totalHours - a.totalHours);

    const departmentStatsArray = Object.values(departmentStats)
      .map(d => ({
        ...d,
        employeeCount: d.employeeCount.size,
        avgHoursPerEmployee: d.employeeCount.size > 0 
          ? Math.round(d.totalHours / d.employeeCount.size * 100) / 100 
          : 0
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    const monthlyTrendArray = Object.values(monthlyTrend);

    // 總計
    const totalHours = overtimeRequests.reduce((sum, r) => sum + r.totalHours, 0);
    const totalRequests = overtimeRequests.length;
    const uniqueEmployees = new Set(overtimeRequests.map(r => r.employeeId)).size;

    return NextResponse.json({
      success: true,
      period: {
        year,
        month: monthResult.value,
        type: monthResult.value !== null ? 'monthly' : 'yearly'
      },
      summary: {
        totalHours: Math.round(totalHours * 100) / 100,
        totalRequests,
        uniqueEmployees,
        avgHoursPerEmployee: uniqueEmployees > 0 
          ? Math.round(totalHours / uniqueEmployees * 100) / 100 
          : 0
      },
      byEmployee: employeeStatsArray.slice(0, 20),  // Top 20
      byDepartment: departmentStatsArray,
      monthlyTrend: monthlyTrendArray,
      // 圖表用資料
      charts: {
        departmentPie: departmentStatsArray.map(d => ({
          label: d.department,
          value: d.totalHours
        })),
        monthlyLine: monthlyTrendArray.map(m => ({
          label: `${m.month}月`,
          value: m.totalHours
        }))
      }
    });
  } catch (error) {
    console.error('取得加班統計失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
