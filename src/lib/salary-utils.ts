/**
 * 薪資計算工具
 * 包含時薪計算、加班費計算等功能
 */

import { prisma } from '@/lib/database';

// 加班類型
export type OvertimeType = 'WEEKDAY' | 'REST_DAY' | 'HOLIDAY';

// 調薪類型
export type AdjustmentType = 'INITIAL' | 'RAISE' | 'PROMOTION' | 'ADJUSTMENT';

/**
 * 根據月薪計算時薪
 * 公式：月薪 ÷ 240
 */
export function calculateHourlyRate(baseSalary: number): number {
  return Math.round((baseSalary / 240) * 100) / 100;
}

/**
 * 取得員工在指定日期的有效薪資
 * 會查找生效日期 <= 指定日期的最新一筆薪資記錄
 */
export async function getEffectiveSalary(employeeId: number, date: Date) {
  // 先嘗試從薪資歷史取得
  const salaryHistory = await prisma.salaryHistory.findFirst({
    where: {
      employeeId,
      effectiveDate: { lte: date }
    },
    orderBy: { effectiveDate: 'desc' }
  });

  if (salaryHistory) {
    return {
      baseSalary: salaryHistory.baseSalary,
      hourlyRate: salaryHistory.hourlyRate,
      effectiveDate: salaryHistory.effectiveDate,
      source: 'history' as const
    };
  }

  // 如果沒有歷史記錄，從員工表取得
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { baseSalary: true, hourlyRate: true }
  });

  if (employee) {
    return {
      baseSalary: employee.baseSalary,
      hourlyRate: employee.hourlyRate,
      effectiveDate: null,
      source: 'employee' as const
    };
  }

  return null;
}

/**
 * 計算加班費
 * 
 * 平日加班：
 *   前 2 小時：時薪 × 1.34
 *   第 3 小時起：時薪 × 1.67
 * 
 * 休息日加班：
 *   前 2 小時：時薪 × 1.34
 *   第 3-8 小時：時薪 × 1.67
 *   第 9 小時起：時薪 × 2.67
 * 
 * 國定假日/例假日：
 *   全部：時薪 × 2
 */
export function calculateOvertimePay(
  hourlyRate: number,
  hours: number,
  overtimeType: OvertimeType
): number {
  if (hours <= 0) return 0;

  // 國定假日/例假日
  if (overtimeType === 'HOLIDAY') {
    return Math.round(hourlyRate * hours * 2);
  }

  // 平日加班
  if (overtimeType === 'WEEKDAY') {
    if (hours <= 2) {
      return Math.round(hourlyRate * hours * 1.34);
    } else {
      const first2Hours = hourlyRate * 2 * 1.34;
      const remainingHours = hourlyRate * (hours - 2) * 1.67;
      return Math.round(first2Hours + remainingHours);
    }
  }

  // 休息日加班
  if (overtimeType === 'REST_DAY') {
    if (hours <= 2) {
      return Math.round(hourlyRate * hours * 1.34);
    } else if (hours <= 8) {
      const first2Hours = hourlyRate * 2 * 1.34;
      const hours3to8 = hourlyRate * (hours - 2) * 1.67;
      return Math.round(first2Hours + hours3to8);
    } else {
      const first2Hours = hourlyRate * 2 * 1.34;
      const hours3to8 = hourlyRate * 6 * 1.67;
      const hoursAfter8 = hourlyRate * (hours - 8) * 2.67;
      return Math.round(first2Hours + hours3to8 + hoursAfter8);
    }
  }

  return 0;
}

/**
 * 計算加班申請的加班費
 * 自動查詢當時的有效時薪
 */
export async function calculateOvertimePayForRequest(
  employeeId: number,
  overtimeDate: Date,
  totalHours: number,
  overtimeType: OvertimeType
) {
  // 取得加班當天的有效薪資
  const salary = await getEffectiveSalary(employeeId, overtimeDate);
  
  if (!salary) {
    return {
      success: false,
      error: '找不到員工薪資資料'
    };
  }

  const hourlyRate = salary.hourlyRate;
  const overtimePay = calculateOvertimePay(hourlyRate, totalHours, overtimeType);

  return {
    success: true,
    hourlyRate,
    totalHours,
    overtimeType,
    overtimePay,
    calculation: getOvertimeCalculationDetail(hourlyRate, totalHours, overtimeType)
  };
}

/**
 * 取得加班費計算明細
 */
function getOvertimeCalculationDetail(
  hourlyRate: number,
  hours: number,
  overtimeType: OvertimeType
): string {
  if (overtimeType === 'HOLIDAY') {
    return `${hourlyRate} × ${hours} × 2 = ${Math.round(hourlyRate * hours * 2)}`;
  }

  if (overtimeType === 'WEEKDAY') {
    if (hours <= 2) {
      return `${hourlyRate} × ${hours} × 1.34 = ${Math.round(hourlyRate * hours * 1.34)}`;
    } else {
      const part1 = Math.round(hourlyRate * 2 * 1.34);
      const part2 = Math.round(hourlyRate * (hours - 2) * 1.67);
      return `(${hourlyRate} × 2 × 1.34 = ${part1}) + (${hourlyRate} × ${hours - 2} × 1.67 = ${part2}) = ${part1 + part2}`;
    }
  }

  if (overtimeType === 'REST_DAY') {
    if (hours <= 2) {
      return `${hourlyRate} × ${hours} × 1.34 = ${Math.round(hourlyRate * hours * 1.34)}`;
    } else if (hours <= 8) {
      const part1 = Math.round(hourlyRate * 2 * 1.34);
      const part2 = Math.round(hourlyRate * (hours - 2) * 1.67);
      return `(${hourlyRate} × 2 × 1.34) + (${hourlyRate} × ${hours - 2} × 1.67) = ${part1 + part2}`;
    } else {
      const part1 = Math.round(hourlyRate * 2 * 1.34);
      const part2 = Math.round(hourlyRate * 6 * 1.67);
      const part3 = Math.round(hourlyRate * (hours - 8) * 2.67);
      return `(${hourlyRate} × 2 × 1.34) + (${hourlyRate} × 6 × 1.67) + (${hourlyRate} × ${hours - 8} × 2.67) = ${part1 + part2 + part3}`;
    }
  }

  return '';
}

/**
 * 調薪並更新員工當前薪資
 */
export async function adjustSalary(params: {
  employeeId: number;
  effectiveDate: Date;
  newBaseSalary: number;
  adjustmentType: AdjustmentType;
  reason?: string;
  notes?: string;
  approvedById: number;
}) {
  const { employeeId, effectiveDate, newBaseSalary, adjustmentType, reason, notes, approvedById } = params;

  // 取得員工當前薪資
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { baseSalary: true }
  });

  if (!employee) {
    return { success: false, error: '找不到員工' };
  }

  const previousSalary = employee.baseSalary;
  const adjustmentAmount = newBaseSalary - previousSalary;
  const newHourlyRate = calculateHourlyRate(newBaseSalary);

  // 建立薪資歷史記錄
  const salaryHistory = await prisma.salaryHistory.create({
    data: {
      employeeId,
      effectiveDate,
      baseSalary: newBaseSalary,
      hourlyRate: newHourlyRate,
      previousSalary,
      adjustmentAmount,
      adjustmentType,
      reason,
      notes,
      approvedById
    }
  });

  // 如果生效日期是今天或之前，更新員工當前薪資
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const effDate = new Date(effectiveDate);
  effDate.setHours(0, 0, 0, 0);

  if (effDate <= today) {
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        baseSalary: newBaseSalary,
        hourlyRate: newHourlyRate
      }
    });
  }

  return {
    success: true,
    salaryHistory,
    previousSalary,
    newBaseSalary,
    adjustmentAmount,
    newHourlyRate
  };
}

/**
 * 取得員工薪資歷史
 */
export async function getSalaryHistory(employeeId: number) {
  return prisma.salaryHistory.findMany({
    where: { employeeId },
    include: {
      approvedBy: {
        select: { id: true, name: true, employeeId: true }
      }
    },
    orderBy: { effectiveDate: 'desc' }
  });
}

/**
 * 初始化員工薪資歷史（首次記錄）
 */
export async function initializeSalaryHistory(employeeId: number, approvedById: number) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { baseSalary: true, hourlyRate: true, hireDate: true }
  });

  if (!employee) {
    return { success: false, error: '找不到員工' };
  }

  // 檢查是否已有歷史記錄
  const existing = await prisma.salaryHistory.findFirst({
    where: { employeeId }
  });

  if (existing) {
    return { success: false, error: '已有薪資歷史記錄' };
  }

  // 建立初始記錄
  const salaryHistory = await prisma.salaryHistory.create({
    data: {
      employeeId,
      effectiveDate: employee.hireDate,
      baseSalary: employee.baseSalary,
      hourlyRate: employee.hourlyRate,
      adjustmentType: 'INITIAL',
      reason: '入職薪資',
      approvedById
    }
  });

  return { success: true, salaryHistory };
}
