import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { 
  calculateMonthlyPayroll, 
  validatePayrollCalculation,
  type EmployeePayrollInfo,
  type AttendanceForPayroll
} from '@/lib/payroll-calculator';
import { OvertimeType } from '@/lib/overtime-calculator';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

// 輔助函數：取得國定假日
async function getHolidaysForMonth(year: number, month: number): Promise<Set<string>> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  
  const holidays = await prisma.holiday.findMany({
    where: {
      year,
      isActive: true,
      date: {
        gte: startDate,
        lte: endDate
      }
    }
  });
  
  return new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
}

// 輔助函數：計算獎金
async function calculateBonusForMonth(
  employee: { id: number; baseSalary: number; hireDate: Date },
  year: number,
  month: number
): Promise<{ festivalBonus: number; yearEndBonus: number }> {
  let festivalBonus = 0;
  let yearEndBonus = 0;

  try {
    const configs = await prisma.bonusConfiguration.findMany({
      where: { isActive: true }
    });

    for (const config of configs) {
      const eligibilityRules = typeof config.eligibilityRules === 'string'
        ? JSON.parse(config.eligibilityRules)
        : config.eligibilityRules || {};
      
      const paymentSchedule = typeof config.paymentSchedule === 'string'
        ? JSON.parse(config.paymentSchedule)
        : config.paymentSchedule || {};

      const hireDate = new Date(employee.hireDate);
      const currentDate = new Date(year, month - 1, 1);
      const serviceMonths = Math.floor(
        (currentDate.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
      );

      const minimumServiceMonths = eligibilityRules.minimumServiceMonths || 0;
      if (serviceMonths < minimumServiceMonths) {
        continue;
      }

      const proRateRatio = Math.min(serviceMonths / 12, 1);

      if (config.bonusType === 'YEAR_END') {
        const paymentMonth = paymentSchedule.yearEndMonth || 2;
        if (month === paymentMonth) {
          const baseMultiplier = eligibilityRules.baseMultiplier || 1;
          yearEndBonus = Math.round(employee.baseSalary * baseMultiplier * proRateRatio);
        }
      } else if (config.bonusType === 'FESTIVAL') {
        const festivalMultipliers = eligibilityRules.festivalMultipliers || {};
        
        if (month === (paymentSchedule.springMonth || 2)) {
          const multiplier = festivalMultipliers.spring_festival || 0.5;
          festivalBonus += Math.round(employee.baseSalary * multiplier * proRateRatio);
        }
        if (month === (paymentSchedule.dragonBoatMonth || 6)) {
          const multiplier = festivalMultipliers.dragon_boat || 0.3;
          festivalBonus += Math.round(employee.baseSalary * multiplier * proRateRatio);
        }
        if (month === (paymentSchedule.midAutumnMonth || 9)) {
          const multiplier = festivalMultipliers.mid_autumn || 0.3;
          festivalBonus += Math.round(employee.baseSalary * multiplier * proRateRatio);
        }
      }
    }
  } catch (error) {
    console.error('計算獎金失敗:', error);
  }

  return { festivalBonus, yearEndBonus };
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const payYear = isPlainObject(body) ? asStringOrNumber(body.payYear) : undefined;
    const payMonth = isPlainObject(body) ? asStringOrNumber(body.payMonth) : undefined;
    const employeeIds = isPlainObject(body) && Array.isArray(body.employeeIds) ? body.employeeIds : undefined;
    const department = isPlainObject(body) && typeof body.department === 'string' ? body.department : undefined;
    const includeBonus = isPlainObject(body) && typeof body.includeBonus === 'boolean' ? body.includeBonus : true;

    if (!payYear || !payMonth) {
      return NextResponse.json({ error: '年份和月份為必填' }, { status: 400 });
    }

    const year = Number(payYear);
    const month = Number(payMonth);

    // 取得國定假日
    const holidayDates = await getHolidaysForMonth(year, month);

    // 建立員工查詢條件（支援部門篩選）
    interface EmployeeWhereClause {
      isActive: boolean;
      id?: { in: number[] };
      department?: string;
    }
    
    const whereClause: EmployeeWhereClause = { isActive: true };
    
    if (employeeIds && employeeIds.length > 0) {
      whereClause.id = { in: employeeIds.map((id: string) => parseInt(id)) };
    }
    if (department) {
      whereClause.department = department;
    }

    const employees = await prisma.employee.findMany({
      where: whereClause
    });

    if (employees.length === 0) {
      return NextResponse.json({ error: '找不到符合條件的員工' }, { status: 400 });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const results = [];
    const errors = [];

    for (const employee of employees) {
      try {
        // 檢查是否已存在該月份的薪資記錄
        const existingRecord = await prisma.payrollRecord.findFirst({
          where: {
            employeeId: employee.id,
            payYear: year,
            payMonth: month
          }
        });

        if (existingRecord) {
          errors.push(`員工 ${employee.name} (${employee.employeeId}) 的 ${year}年${month}月 薪資記錄已存在`);
          continue;
        }

        // 獲取該員工該月份的考勤記錄
        const attendanceRecords = await prisma.attendanceRecord.findMany({
          where: {
            employeeId: employee.id,
            workDate: {
              gte: startDate,
              lte: endDate
            }
          }
        });

        // 轉換考勤記錄格式，整合國定假日
        const attendanceForPayroll: AttendanceForPayroll[] = attendanceRecords.map(record => {
          const dateStr = record.workDate.toISOString().split('T')[0];
          const dayOfWeek = record.workDate.getDay();
          const isHoliday = holidayDates.has(dateStr);
          
          let overtimeType = OvertimeType.WEEKDAY;
          if (isHoliday) {
            overtimeType = OvertimeType.HOLIDAY;
          } else if (dayOfWeek === 6) {
            overtimeType = OvertimeType.REST_DAY;
          } else if (dayOfWeek === 0) {
            overtimeType = OvertimeType.MANDATORY_REST;
          }
          
          return {
            workDate: record.workDate,
            regularHours: record.regularHours || 0,
            overtimeHours: record.overtimeHours || 0,
            overtimeType,
            isHoliday,
            isRestDay: dayOfWeek === 6,
            isMandatoryRest: dayOfWeek === 0
          };
        });

        // 準備員工薪資計算資訊
        const employeeInfo: EmployeePayrollInfo = {
          id: employee.id,
          employeeId: employee.employeeId,
          name: employee.name,
          baseSalary: employee.baseSalary,
          hourlyRate: employee.hourlyRate,
          department: employee.department || '',
          position: employee.position || '',
          dependents: employee.dependents || 0,
          insuredBase: employee.insuredBase || undefined,
          laborPensionSelfRate: employee.laborPensionSelfRate || 0,
          employeeType: employee.employeeType || 'MONTHLY',
          laborInsuranceActive: employee.laborInsuranceActive !== false,
          healthInsuranceActive: employee.healthInsuranceActive !== false
        };

        // 使用薪資計算器
        const payrollResult = calculateMonthlyPayroll(
          employeeInfo,
          attendanceForPayroll,
          year,
          month
        );

        // 驗證計算結果
        const validation = validatePayrollCalculation(payrollResult);
        if (!validation.isValid) {
          errors.push(`員工 ${employee.name} 薪資計算驗證失敗: ${validation.errors.join(', ')}`);
          continue;
        }

        // 計算獎金
        let festivalBonus = 0;
        let yearEndBonus = 0;
        if (includeBonus) {
          const bonusResult = await calculateBonusForMonth(
            { id: employee.id, baseSalary: employee.baseSalary, hireDate: employee.hireDate },
            year,
            month
          );
          festivalBonus = bonusResult.festivalBonus;
          yearEndBonus = bonusResult.yearEndBonus;
        }

        const totalBonus = festivalBonus + yearEndBonus;
        const adjustedGrossPay = payrollResult.grossPay + totalBonus;
        const adjustedNetPay = payrollResult.netPay + totalBonus;

        // 創建薪資記錄（獎金已合併到 grossPay/netPay）
        const payrollRecord = await prisma.payrollRecord.create({
          data: {
            employeeId: employee.id,
            payYear: year,
            payMonth: month,
            regularHours: payrollResult.regularHours,
            overtimeHours: payrollResult.totalOvertimeHours,
            hourlyWage: employee.hourlyRate || 0,
            basePay: payrollResult.basePay,
            overtimePay: payrollResult.totalOvertimePay,
            grossPay: adjustedGrossPay,
            laborInsurance: payrollResult.deductions.laborInsurance,
            healthInsurance: payrollResult.deductions.healthInsurance,
            supplementaryInsurance: payrollResult.deductions.supplementaryInsurance,
            laborPensionSelf: payrollResult.deductions.laborPensionSelf,
            incomeTax: payrollResult.deductions.incomeTax,
            totalDeductions: payrollResult.totalDeductions,
            netPay: adjustedNetPay,
            calculationNotes: totalBonus > 0 ? {
              festivalBonus,
              yearEndBonus,
              totalBonus,
              bonusNote: `含三節獎金 ${festivalBonus}、年終獎金 ${yearEndBonus}`
            } : undefined
          },
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

        results.push(payrollRecord);
      } catch (error) {
        console.error(`為員工 ${employee.name} 生成薪資記錄失敗:`, error);
        errors.push(`員工 ${employee.name} (${employee.employeeId}) 薪資記錄生成失敗`);
      }
    }

    if (results.length === 0 && errors.length > 0) {
      return NextResponse.json({
        error: errors.length === 1 ? errors[0] : '批量生成薪資記錄失敗，請檢查錯誤明細後再試',
        errors,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `成功生成 ${results.length} 筆薪資記錄`,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('批量生成薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
