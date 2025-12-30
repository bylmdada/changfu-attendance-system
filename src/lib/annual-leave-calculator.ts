/**
 * 年假自動計算模組
 * 根據勞基法規定，依到職年資自動計算特休天數
 * 使用週年制（以到職日為基準）
 */

import { prisma } from '@/lib/database';

/**
 * 勞基法特休規定（2017年後）
 * 
 * | 年資 | 特休天數 |
 * |------|----------|
 * | 6個月 ~ 1年 | 3天 |
 * | 1年 ~ 2年 | 7天 |
 * | 2年 ~ 3年 | 10天 |
 * | 3年 ~ 5年 | 14天 |
 * | 5年 ~ 10年 | 15天 |
 * | 10年以上 | 每年加1天，最多30天 |
 */

export interface AnnualLeaveCalculation {
  employeeId: number;
  employeeName: string;
  hireDate: Date;
  referenceDate: Date;
  yearsOfService: number;       // 完整年資（年）
  monthsOfService: number;      // 總月數
  entitledDays: number;         // 應得天數
  calculation: string;          // 計算說明
}

export interface AnnualLeaveEntitlement {
  year: number;
  totalDays: number;            // 特休總天數
  usedDays: number;             // 已使用
  remainingDays: number;        // 剩餘
  expiryDate: Date;             // 到期日
  source: 'SYSTEM' | 'MANUAL';  // 來源
}

/**
 * 計算到職年資（精確到月）
 */
export function calculateYearsOfService(hireDate: Date, referenceDate: Date = new Date()): {
  years: number;
  months: number;
  totalMonths: number;
} {
  const hire = new Date(hireDate);
  const ref = new Date(referenceDate);
  
  let years = ref.getFullYear() - hire.getFullYear();
  let months = ref.getMonth() - hire.getMonth();
  
  // 調整月份
  if (months < 0) {
    years--;
    months += 12;
  }
  
  // 檢查日期是否已過（當月是否已到到職日）
  if (ref.getDate() < hire.getDate()) {
    months--;
    if (months < 0) {
      years--;
      months += 12;
    }
  }
  
  const totalMonths = years * 12 + months;
  
  return { years, months, totalMonths };
}

/**
 * 根據勞基法計算特休天數（週年制）
 * @param hireDate 到職日
 * @param referenceDate 計算基準日（預設為今天）
 * @returns 應得特休天數
 */
export function calculateAnnualLeaveDays(hireDate: Date, referenceDate: Date = new Date()): {
  days: number;
  description: string;
  yearsOfService: number;
  monthsOfService: number;
} {
  const { years, months, totalMonths } = calculateYearsOfService(hireDate, referenceDate);
  
  let days = 0;
  let description = '';
  
  if (totalMonths < 6) {
    // 未滿6個月：無特休
    days = 0;
    description = `年資 ${totalMonths} 個月，未滿 6 個月無特休`;
  } else if (totalMonths < 12) {
    // 6個月 ~ 1年：3天
    days = 3;
    description = `年資 ${totalMonths} 個月（滿 6 個月未滿 1 年），特休 3 天`;
  } else if (years < 2) {
    // 1年 ~ 2年：7天
    days = 7;
    description = `年資 ${years} 年 ${months} 個月（滿 1 年未滿 2 年），特休 7 天`;
  } else if (years < 3) {
    // 2年 ~ 3年：10天
    days = 10;
    description = `年資 ${years} 年 ${months} 個月（滿 2 年未滿 3 年），特休 10 天`;
  } else if (years < 5) {
    // 3年 ~ 5年：14天
    days = 14;
    description = `年資 ${years} 年 ${months} 個月（滿 3 年未滿 5 年），特休 14 天`;
  } else if (years < 10) {
    // 5年 ~ 10年：15天
    days = 15;
    description = `年資 ${years} 年 ${months} 個月（滿 5 年未滿 10 年），特休 15 天`;
  } else {
    // 10年以上：每年加1天，最多30天
    // 10年=16天, 11年=17天, ..., 24年以上=30天
    const baseYears = 10;
    const baseDays = 16;
    const extraYears = years - baseYears;
    days = Math.min(baseDays + extraYears, 30);
    description = `年資 ${years} 年 ${months} 個月（滿 10 年），特休 ${days} 天`;
  }
  
  return { days, description, yearsOfService: years, monthsOfService: totalMonths };
}

/**
 * 計算員工的年假權益
 */
export async function getEmployeeAnnualLeave(employeeId: number): Promise<AnnualLeaveCalculation | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, hireDate: true }
  });
  
  if (!employee) return null;
  
  const today = new Date();
  const { days, description, yearsOfService, monthsOfService } = calculateAnnualLeaveDays(employee.hireDate, today);
  
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    hireDate: employee.hireDate,
    referenceDate: today,
    yearsOfService,
    monthsOfService,
    entitledDays: days,
    calculation: description
  };
}

/**
 * 批量計算所有員工的年假並更新資料庫
 */
export async function calculateAllEmployeesAnnualLeave(year: number): Promise<{
  success: number;
  failed: number;
  results: AnnualLeaveCalculation[];
}> {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, name: true, hireDate: true }
  });
  
  const results: AnnualLeaveCalculation[] = [];
  let success = 0;
  let failed = 0;
  
  // 計算年度基準日（使用週年制，以到職日為準）
  // 對於給定年度，計算員工在該年度內的特休權益
  const yearEnd = new Date(year, 11, 31); // 該年12月31日
  
  for (const employee of employees) {
    try {
      const { days, description, yearsOfService, monthsOfService } = calculateAnnualLeaveDays(
        employee.hireDate, 
        yearEnd
      );
      
      // 計算週年制到期日（到職週年後一年內使用）
      const hireDateThisYear = new Date(year, employee.hireDate.getMonth(), employee.hireDate.getDate());
      const expiryDate = new Date(hireDateThisYear);
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      
      // 更新或建立年假記錄
      await prisma.annualLeave.upsert({
        where: {
          employeeId_year: {
            employeeId: employee.id,
            year: year
          }
        },
        create: {
          employeeId: employee.id,
          year: year,
          yearsOfService: yearsOfService,
          totalDays: days,
          usedDays: 0,
          remainingDays: days,
          expiryDate: expiryDate
        },
        update: {
          yearsOfService: yearsOfService,
          totalDays: days,
          remainingDays: days, // 注意：這會重置剩餘天數，實際使用時需考慮已使用天數
        }
      });
      
      // 記錄歷史
      await prisma.leaveBalanceHistory.create({
        data: {
          employeeId: employee.id,
          year: year,
          leaveType: 'ANNUAL',
          entitled: days,
          used: 0,
          remaining: days,
          source: 'SYSTEM_CALC',
          note: description
        }
      });
      
      results.push({
        employeeId: employee.id,
        employeeName: employee.name,
        hireDate: employee.hireDate,
        referenceDate: yearEnd,
        yearsOfService,
        monthsOfService,
        entitledDays: days,
        calculation: description
      });
      
      success++;
    } catch (error) {
      console.error(`計算員工 ${employee.name} 年假失敗:`, error);
      failed++;
    }
  }
  
  return { success, failed, results };
}

/**
 * 取得員工年假詳情
 */
export async function getEmployeeAnnualLeaveDetails(employeeId: number, year: number): Promise<AnnualLeaveEntitlement | null> {
  const leave = await prisma.annualLeave.findUnique({
    where: {
      employeeId_year: {
        employeeId,
        year
      }
    }
  });
  
  if (!leave) return null;
  
  return {
    year: leave.year,
    totalDays: leave.totalDays,
    usedDays: leave.usedDays,
    remainingDays: leave.remainingDays,
    expiryDate: leave.expiryDate,
    source: 'SYSTEM'
  };
}

/**
 * 更新員工年假使用天數
 */
export async function updateAnnualLeaveUsage(
  employeeId: number, 
  year: number, 
  usedDays: number,
  note?: string
): Promise<boolean> {
  try {
    const leave = await prisma.annualLeave.findUnique({
      where: {
        employeeId_year: {
          employeeId,
          year
        }
      }
    });
    
    if (!leave) return false;
    
    const newUsed = leave.usedDays + usedDays;
    const newRemaining = leave.totalDays - newUsed;
    
    if (newRemaining < 0) {
      throw new Error('年假餘額不足');
    }
    
    await prisma.annualLeave.update({
      where: {
        employeeId_year: {
          employeeId,
          year
        }
      },
      data: {
        usedDays: newUsed,
        remainingDays: newRemaining
      }
    });
    
    // 記錄使用歷史
    await prisma.leaveBalanceHistory.create({
      data: {
        employeeId,
        year,
        leaveType: 'ANNUAL',
        entitled: leave.totalDays,
        used: newUsed,
        remaining: newRemaining,
        source: 'USED',
        note: note || `使用 ${usedDays} 天年假`
      }
    });
    
    return true;
  } catch (error) {
    console.error('更新年假使用天數失敗:', error);
    return false;
  }
}
