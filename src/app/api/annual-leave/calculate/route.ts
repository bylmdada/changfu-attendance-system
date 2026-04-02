import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { 
  calculateAnnualLeaveDays, 
  calculateAllEmployeesAnnualLeave,
  getEmployeeAnnualLeave 
} from '@/lib/annual-leave-calculator';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';

/**
 * GET - 查詢員工年假詳情或列表
 */
export async function GET(request: NextRequest) {
  try {
    // 驗證登入
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    const user = await getUserFromToken(token);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());

    if (employeeId) {
      // 查詢單一員工
      const empId = parseInt(employeeId);
      
      // 取得當前計算值
      const calculation = await getEmployeeAnnualLeave(empId);
      
      // 取得資料庫記錄
      const leave = await prisma.annualLeave.findUnique({
        where: {
          employeeId_year: {
            employeeId: empId,
            year
          }
        },
        include: {
          employee: {
            select: { name: true, employeeId: true, department: true, hireDate: true }
          }
        }
      });

      // 取得歷史記錄
      const history = await prisma.leaveBalanceHistory.findMany({
        where: { employeeId: empId, year, leaveType: 'ANNUAL' },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      return NextResponse.json({
        success: true,
        calculation,
        leave,
        history
      });
    }

    // 查詢所有員工年假列表
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        hireDate: true,
        annualLeaves: {
          where: { year },
          select: {
            year: true,
            yearsOfService: true,
            totalDays: true,
            usedDays: true,
            remainingDays: true,
            expiryDate: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    // 合併計算結果
    const results = employees.map(emp => {
      const { days, description, yearsOfService, monthsOfService } = calculateAnnualLeaveDays(emp.hireDate);
      const dbRecord = emp.annualLeaves[0];
      
      return {
        employeeId: emp.id,
        employeeCode: emp.employeeId,
        name: emp.name,
        department: emp.department,
        hireDate: emp.hireDate,
        yearsOfService,
        monthsOfService,
        calculatedDays: days,
        calculation: description,
        // 資料庫記錄
        dbRecord: dbRecord ? {
          totalDays: dbRecord.totalDays,
          usedDays: dbRecord.usedDays,
          remainingDays: dbRecord.remainingDays,
          expiryDate: dbRecord.expiryDate
        } : null,
        // 是否需要更新
        needsUpdate: !dbRecord || dbRecord.totalDays !== days
      };
    });

    // 統計
    const stats = {
      totalEmployees: results.length,
      hasRecord: results.filter(r => r.dbRecord).length,
      needsUpdate: results.filter(r => r.needsUpdate).length,
      totalEntitled: results.reduce((sum, r) => sum + r.calculatedDays, 0),
      totalUsed: results.reduce((sum, r) => sum + (r.dbRecord?.usedDays || 0), 0)
    };

    return NextResponse.json({
      success: true,
      year,
      employees: results,
      stats
    });
  } catch (error) {
    console.error('查詢年假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

/**
 * POST - 批量計算年假
 */
export async function POST(request: NextRequest) {
  try {
    // 驗證登入和權限
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    const user = await getUserFromToken(token);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { year, employeeIds } = body;
    
    const targetYear = year || new Date().getFullYear();

    if (employeeIds && Array.isArray(employeeIds)) {
      // 計算指定員工
      const results = [];
      for (const empId of employeeIds) {
        const calculation = await getEmployeeAnnualLeave(empId);
        if (calculation) {
          // 更新資料庫
          const hireDateThisYear = new Date(targetYear, new Date(calculation.hireDate).getMonth(), new Date(calculation.hireDate).getDate());
          const expiryDate = new Date(hireDateThisYear);
          expiryDate.setFullYear(expiryDate.getFullYear() + 1);

          await prisma.annualLeave.upsert({
            where: {
              employeeId_year: {
                employeeId: empId,
                year: targetYear
              }
            },
            create: {
              employeeId: empId,
              year: targetYear,
              yearsOfService: calculation.yearsOfService,
              totalDays: calculation.entitledDays,
              usedDays: 0,
              remainingDays: calculation.entitledDays,
              expiryDate
            },
            update: {
              yearsOfService: calculation.yearsOfService,
              totalDays: calculation.entitledDays
            }
          });

          results.push(calculation);
        }
      }

      return NextResponse.json({
        success: true,
        message: `已計算 ${results.length} 位員工的年假`,
        results
      });
    }

    // 批量計算所有員工
    const result = await calculateAllEmployeesAnnualLeave(targetYear);

    return NextResponse.json({
      message: `已計算 ${result.success} 位員工的年假，${result.failed} 位失敗`,
      year: targetYear,
      successCount: result.success,
      failedCount: result.failed,
      results: result.results
    });
  } catch (error) {
    console.error('計算年假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
