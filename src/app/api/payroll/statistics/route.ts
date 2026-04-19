import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseIntegerQueryParam } from '@/lib/query-params';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以查看薪資統計
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearInput = searchParams.get('year') ?? new Date().getFullYear().toString();
    const monthInput = searchParams.get('month');
    const department = searchParams.get('department');

    const yearResult = parseIntegerQueryParam(yearInput, { min: 1900, max: 9999 });
    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json({ error: 'year 格式錯誤' }, { status: 400 });
    }

    const monthResult = parseIntegerQueryParam(monthInput, { min: 1, max: 12 });
    if (!monthResult.isValid) {
      return NextResponse.json({ error: 'month 格式錯誤' }, { status: 400 });
    }

    const year = yearResult.value;
    const month = monthResult.value;

    const employeeFilter = department
      ? {
          employee: {
            is: {
              department,
            },
          },
        }
      : {};

    const whereCondition: {
      payYear: number;
      payMonth?: number;
      employee?: {
        is: {
          department: string;
        };
      };
    } = {
      payYear: year,
      ...employeeFilter,
    };

    if (month !== null) {
      whereCondition.payMonth = month;
    }

    // 獲取薪資統計數據
    const payrollStats = await prisma.payrollRecord.aggregate({
      where: whereCondition,
      _count: {
        id: true
      },
      _sum: {
        regularHours: true,
        overtimeHours: true,
        basePay: true,
        overtimePay: true,
        grossPay: true,
        netPay: true
      },
      _avg: {
        regularHours: true,
        overtimeHours: true,
        basePay: true,
        overtimePay: true,
        grossPay: true,
        netPay: true
      }
    });

    // 獲取部門薪資統計
    const departmentStats = await prisma.payrollRecord.findMany({
      where: whereCondition,
      select: {
        employeeId: true,
        grossPay: true,
        netPay: true,
        regularHours: true,
        overtimeHours: true,
        employee: {
          select: {
            department: true
          }
        }
      }
    });

    // 按部門分組統計
    interface DepartmentSummaryAccumulator {
      department: string;
      recordCount: number;
      employeeIds: Set<number>;
      totalGrossPay: number;
      totalNetPay: number;
      totalRegularHours: number;
      totalOvertimeHours: number;
      avgGrossPay: number;
      avgNetPay: number;
    }

    interface DepartmentSummary {
      department: string;
      employeeCount: number;
      totalGrossPay: number;
      totalNetPay: number;
      totalRegularHours: number;
      totalOvertimeHours: number;
      avgGrossPay: number;
      avgNetPay: number;
    }

    const departmentSummary = departmentStats.reduce((acc, record) => {
      const dept = record.employee.department || '未分配部門';
      
      if (!acc[dept]) {
        acc[dept] = {
          department: dept,
          recordCount: 0,
          employeeIds: new Set<number>(),
          totalGrossPay: 0,
          totalNetPay: 0,
          totalRegularHours: 0,
          totalOvertimeHours: 0,
          avgGrossPay: 0,
          avgNetPay: 0
        };
      }
      
      acc[dept].recordCount += 1;
      acc[dept].employeeIds.add(record.employeeId);
      acc[dept].totalGrossPay += record.grossPay;
      acc[dept].totalNetPay += record.netPay;
      acc[dept].totalRegularHours += record.regularHours;
      acc[dept].totalOvertimeHours += record.overtimeHours;
      
      return acc;
    }, {} as Record<string, DepartmentSummaryAccumulator>);

    const normalizedDepartmentSummary = Object.values(departmentSummary)
      .map((dept): DepartmentSummary => ({
        department: dept.department,
        employeeCount: dept.employeeIds.size,
        totalGrossPay: dept.totalGrossPay,
        totalNetPay: dept.totalNetPay,
        totalRegularHours: dept.totalRegularHours,
        totalOvertimeHours: dept.totalOvertimeHours,
        avgGrossPay: dept.recordCount > 0 ? dept.totalGrossPay / dept.recordCount : 0,
        avgNetPay: dept.recordCount > 0 ? dept.totalNetPay / dept.recordCount : 0,
      }))
      .sort((a, b) => b.totalGrossPay - a.totalGrossPay);

    // 獲取月度趨勢數據（有指定月份時只查該月份）
    const monthsToQuery = month !== null
      ? [month]
      : Array.from({ length: 12 }, (_, index) => index + 1);
    const monthlyTrends = [];
    for (const m of monthsToQuery) {
      const monthlyStats = await prisma.payrollRecord.aggregate({
        where: {
          payYear: year,
          payMonth: m,
          ...employeeFilter,
        },
        _count: {
          id: true
        },
        _sum: {
          grossPay: true,
          netPay: true,
          regularHours: true,
          overtimeHours: true
        }
      });

      monthlyTrends.push({
        month: m,
        employeeCount: monthlyStats._count.id,
        totalGrossPay: monthlyStats._sum.grossPay || 0,
        totalNetPay: monthlyStats._sum.netPay || 0,
        totalRegularHours: monthlyStats._sum.regularHours || 0,
        totalOvertimeHours: monthlyStats._sum.overtimeHours || 0
      });
    }

    // 獲取薪資範圍分布
    const salaryRanges = [
      { min: 0, max: 30000, label: '3萬以下' },
      { min: 30000, max: 50000, label: '3-5萬' },
      { min: 50000, max: 80000, label: '5-8萬' },
      { min: 80000, max: 100000, label: '8-10萬' },
      { min: 100000, max: Infinity, label: '10萬以上' }
    ];

    const salaryDistribution = await Promise.all(
      salaryRanges.map(async (range) => {
        const whereCondition: {
          payYear: number;
          payMonth?: number;
          employee?: {
            is: {
              department: string;
            };
          };
          grossPay: {
            gte: number;
            lt?: number;
          };
        } = {
          payYear: year,
          ...employeeFilter,
          grossPay: {
            gte: range.min
          }
        };

        if (range.max !== Infinity) {
          whereCondition.grossPay.lt = range.max;
        }

        if (month !== null) {
          whereCondition.payMonth = month;
        }

        const count = await prisma.payrollRecord.count({
          where: whereCondition
        });

        return {
          label: range.label,
          count,
          min: range.min,
          max: range.max
        };
      })
    );

    return NextResponse.json({
      success: true,
      statistics: {
        overall: {
          totalRecords: payrollStats._count.id,
          totalGrossPay: payrollStats._sum.grossPay || 0,
          totalNetPay: payrollStats._sum.netPay || 0,
          totalOvertimePay: payrollStats._sum.overtimePay || 0,
          totalRegularHours: payrollStats._sum.regularHours || 0,
          totalOvertimeHours: payrollStats._sum.overtimeHours || 0,
          avgGrossPay: payrollStats._avg.grossPay || 0,
          avgNetPay: payrollStats._avg.netPay || 0,
          avgRegularHours: payrollStats._avg.regularHours || 0,
          avgOvertimeHours: payrollStats._avg.overtimeHours || 0
        },
        departmentStats: normalizedDepartmentSummary,
        monthlyTrends,
        salaryDistribution
      }
    });
  } catch (error) {
    console.error('獲取薪資統計失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
