import { NextRequest, NextResponse } from 'next/server';
import { 
  calculateAnnualLeaveDays, 
  calculateAllEmployeesAnnualLeave,
  getEmployeeAnnualLeave 
} from '@/lib/annual-leave-calculator';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveIntegerBodyValue(value: unknown, defaultValue?: number) {
  if (value === undefined || value === null || value === '') {
    return {
      value: defaultValue ?? null,
      isValid: true,
    };
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return {
      value: null,
      isValid: false,
    };
  }

  return parseIntegerQueryParam(String(value), {
    defaultValue: defaultValue ?? null,
    min: 1,
    max: 9999,
  });
}

function parseEmployeeIdsBody(value: unknown) {
  if (value === undefined) {
    return {
      value: undefined,
      isValid: true,
    };
  }

  if (!Array.isArray(value)) {
    return {
      value: undefined,
      isValid: false,
    };
  }

  const parsedIds: number[] = [];
  for (const item of value) {
    const parsedItem = parsePositiveIntegerBodyValue(item);
    if (!parsedItem.isValid || parsedItem.value === null) {
      return {
        value: undefined,
        isValid: false,
      };
    }

    parsedIds.push(parsedItem.value);
  }

  return {
    value: parsedIds,
    isValid: true,
  };
}

/**
 * GET - 查詢員工年假詳情或列表
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const yearResult = parseIntegerQueryParam(searchParams.get('year'), {
      defaultValue: new Date().getFullYear(),
      min: 1,
      max: 9999,
    });

    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json({ error: 'year 參數格式無效' }, { status: 400 });
    }

    const year = yearResult.value;

    if (employeeId) {
      // 查詢單一員工
      const employeeIdResult = parseIntegerQueryParam(employeeId, { min: 1, max: 99999999 });
      if (!employeeIdResult.isValid || employeeIdResult.value === null) {
        return NextResponse.json({ error: 'employeeId 參數格式無效' }, { status: 400 });
      }

      const empId = employeeIdResult.value;
      
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
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的年假計算資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的年假計算資料' }, { status: 400 });
    }

    const { year, employeeIds } = body;

    const yearResult = parsePositiveIntegerBodyValue(year, new Date().getFullYear());
    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json({ error: 'year 參數格式無效' }, { status: 400 });
    }

    const targetYear = yearResult.value;
    const employeeIdsResult = parseEmployeeIdsBody(employeeIds);
    if (!employeeIdsResult.isValid) {
      return NextResponse.json({ error: 'employeeIds 參數格式無效' }, { status: 400 });
    }

    if (employeeIdsResult.value !== undefined) {
      // 計算指定員工
      const results = [];
      for (const empId of employeeIdsResult.value) {
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
