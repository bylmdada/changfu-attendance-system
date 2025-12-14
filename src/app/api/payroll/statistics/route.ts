import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 只有管理員和HR可以查看薪資統計
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || new Date().getFullYear().toString();
    const month = searchParams.get('month');

    const whereCondition: {
      payYear: number;
      payMonth?: number;
    } = {
      payYear: parseInt(year)
    };

    if (month) {
      whereCondition.payMonth = parseInt(month);
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
      include: {
        employee: {
          select: {
            department: true
          }
        }
      }
    });

    // 按部門分組統計
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
          employeeCount: 0,
          totalGrossPay: 0,
          totalNetPay: 0,
          totalRegularHours: 0,
          totalOvertimeHours: 0,
          avgGrossPay: 0,
          avgNetPay: 0
        };
      }
      
      acc[dept].employeeCount += 1;
      acc[dept].totalGrossPay += record.grossPay;
      acc[dept].totalNetPay += record.netPay;
      acc[dept].totalRegularHours += record.regularHours;
      acc[dept].totalOvertimeHours += record.overtimeHours;
      
      return acc;
    }, {} as Record<string, DepartmentSummary>);

    // 計算部門平均值
    Object.values(departmentSummary).forEach((dept: DepartmentSummary) => {
      dept.avgGrossPay = dept.totalGrossPay / dept.employeeCount;
      dept.avgNetPay = dept.totalNetPay / dept.employeeCount;
    });

    // 獲取月度趨勢數據（當年每月統計）
    const monthlyTrends = [];
    for (let m = 1; m <= 12; m++) {
      const monthlyStats = await prisma.payrollRecord.aggregate({
        where: {
          payYear: parseInt(year),
          payMonth: m
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
          grossPay: {
            gte: number;
            lt?: number;
          };
        } = {
          payYear: parseInt(year),
          grossPay: {
            gte: range.min
          }
        };

        if (range.max !== Infinity) {
          whereCondition.grossPay.lt = range.max;
        }

        if (month) {
          whereCondition.payMonth = parseInt(month);
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
          totalRegularHours: payrollStats._sum.regularHours || 0,
          totalOvertimeHours: payrollStats._sum.overtimeHours || 0,
          avgGrossPay: payrollStats._avg.grossPay || 0,
          avgNetPay: payrollStats._avg.netPay || 0,
          avgRegularHours: payrollStats._avg.regularHours || 0,
          avgOvertimeHours: payrollStats._avg.overtimeHours || 0
        },
        departmentStats: Object.values(departmentSummary),
        monthlyTrends,
        salaryDistribution
      }
    });
  } catch (error) {
    console.error('獲取薪資統計失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
