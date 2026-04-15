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
    // 取得獎金配置
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

      // 計算服務月數
      const hireDate = new Date(employee.hireDate);
      const currentDate = new Date(year, month - 1, 1);
      const serviceMonths = Math.floor(
        (currentDate.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
      );

      const minimumServiceMonths = eligibilityRules.minimumServiceMonths || 0;
      if (serviceMonths < minimumServiceMonths) {
        continue; // 不符合最低服務月數
      }

      // 計算按比例係數
      const proRateRatio = Math.min(serviceMonths / 12, 1);

      if (config.bonusType === 'YEAR_END') {
        // 年終獎金 - 檢查發放月份
        const paymentMonth = paymentSchedule.yearEndMonth || 2;
        if (month === paymentMonth) {
          const baseMultiplier = eligibilityRules.baseMultiplier || 1;
          yearEndBonus = Math.round(employee.baseSalary * baseMultiplier * proRateRatio);
        }
      } else if (config.bonusType === 'FESTIVAL') {
        // 三節獎金
        const festivalMultipliers = eligibilityRules.festivalMultipliers || {};
        
        // 春節
        if (month === (paymentSchedule.springMonth || 2)) {
          const multiplier = festivalMultipliers.spring_festival || 0.5;
          festivalBonus += Math.round(employee.baseSalary * multiplier * proRateRatio);
        }
        // 端午
        if (month === (paymentSchedule.dragonBoatMonth || 6)) {
          const multiplier = festivalMultipliers.dragon_boat || 0.3;
          festivalBonus += Math.round(employee.baseSalary * multiplier * proRateRatio);
        }
        // 中秋
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

// 預覽薪資計算（不儲存）
export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
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

    if (!payYear || !payMonth) {
      return NextResponse.json({ error: '年份和月份為必填' }, { status: 400 });
    }

    const year = Number(payYear);
    const month = Number(payMonth);

    // 取得國定假日
    const holidayDates = await getHolidaysForMonth(year, month);

    // 建立員工查詢條件
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

    // 計算日期範圍
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const previews = [];
    const existingRecords = [];

    for (const employee of employees) {
      // 檢查是否已存在記錄
      const existingRecord = await prisma.payrollRecord.findFirst({
        where: {
          employeeId: employee.id,
          payYear: year,
          payMonth: month
        }
      });

      if (existingRecord) {
        existingRecords.push({
          employeeId: employee.employeeId,
          employeeName: employee.name,
          department: employee.department,
          existing: true
        });
        continue;
      }

      // 取得考勤記錄
      const attendanceRecords = await prisma.attendanceRecord.findMany({
        where: {
          employeeId: employee.id,
          workDate: {
            gte: startDate,
            lte: endDate
          }
        }
      });

      // 轉換考勤記錄
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

      // 員工資訊
      const employeeInfo: EmployeePayrollInfo = {
        id: employee.id,
        employeeId: employee.employeeId,
        name: employee.name,
        baseSalary: employee.baseSalary,
        hourlyRate: employee.hourlyRate,
        department: employee.department || '',
        position: employee.position || '',
        dependents: employee.dependents || 0,
        insuredBase: employee.insuredBase || undefined
      };

      // 計算薪資
      const payrollResult = calculateMonthlyPayroll(
        employeeInfo,
        attendanceForPayroll,
        year,
        month
      );

      // 驗證
      const validation = validatePayrollCalculation(payrollResult);

      // 計算獎金
      const { festivalBonus, yearEndBonus } = await calculateBonusForMonth(
        { id: employee.id, baseSalary: employee.baseSalary, hireDate: employee.hireDate },
        year,
        month
      );

      // 計算總計
      const totalBonus = festivalBonus + yearEndBonus;
      const adjustedGrossPay = payrollResult.grossPay + totalBonus;
      const adjustedNetPay = payrollResult.netPay + totalBonus;

      previews.push({
        employeeId: employee.employeeId,
        employeeName: employee.name,
        department: employee.department,
        position: employee.position,
        baseSalary: employee.baseSalary,
        regularHours: payrollResult.regularHours,
        overtimeHours: payrollResult.totalOvertimeHours,
        basePay: payrollResult.basePay,
        overtimePay: payrollResult.totalOvertimePay,
        festivalBonus,
        yearEndBonus,
        totalBonus,
        grossPay: adjustedGrossPay,
        deductions: payrollResult.deductions,
        totalDeductions: payrollResult.totalDeductions,
        netPay: adjustedNetPay,
        isValid: validation.isValid,
        errors: validation.errors
      });
    }

    // 統計資訊
    const summary = {
      totalEmployees: employees.length,
      previewCount: previews.length,
      existingCount: existingRecords.length,
      totalGrossPay: previews.reduce((sum, p) => sum + p.grossPay, 0),
      totalNetPay: previews.reduce((sum, p) => sum + p.netPay, 0),
      totalBonus: previews.reduce((sum, p) => sum + p.totalBonus, 0),
      totalDeductions: previews.reduce((sum, p) => sum + p.totalDeductions, 0)
    };

    return NextResponse.json({
      success: true,
      year,
      month,
      summary,
      previews,
      existingRecords
    });
  } catch (error) {
    console.error('預覽薪資計算失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
