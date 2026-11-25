/**
 * 薪資計算工具
 * 包含時薪計算、加班費計算等功能
 */

import { prisma } from '@/lib/database';
import { calculateMonthlySalaryHourlyRate } from '@/lib/hourly-rate';
import { toTaiwanDateStr } from '@/lib/timezone';

// 加班類型
export type OvertimeType = 'WEEKDAY' | 'REST_DAY' | 'HOLIDAY' | 'MANDATORY_REST';

const WEEKDAY_FIRST_TWO_HOURS_RATE = 4 / 3;
const WEEKDAY_AFTER_TWO_HOURS_RATE = 5 / 3;
const REST_DAY_AFTER_EIGHT_HOURS_RATE = 8 / 3;

// 調薪類型
export type AdjustmentType = 'INITIAL' | 'RAISE' | 'PROMOTION' | 'ADJUSTMENT';

/**
 * 根據月薪計算時薪
 * 公式：月薪 ÷ 240，四捨五入至整數，與員工管理自動計算保持一致
 */
export function calculateHourlyRate(baseSalary: number): number {
  return calculateMonthlySalaryHourlyRate(baseSalary);
}

/**
 * 取得員工在指定日期的有效薪資
 * 會查找生效日期 <= 指定日期的最新一筆薪資記錄
 */
export async function getEffectiveSalary(
  employeeId: number,
  date: Date,
  fallbackSalary?: { baseSalary: number; hourlyRate: number }
) {
  // 先嘗試從薪資歷史取得
  const salaryHistory = await prisma.salaryHistory.findFirst({
    where: {
      employeeId,
      effectiveDate: { lte: date }
    },
    orderBy: [
      { effectiveDate: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]
  });

  if (salaryHistory) {
    return {
      baseSalary: salaryHistory.baseSalary,
      hourlyRate: salaryHistory.hourlyRate,
      effectiveDate: salaryHistory.effectiveDate,
      source: 'history' as const
    };
  }

  if (fallbackSalary) {
    return {
      ...fallbackSalary,
      effectiveDate: null,
      source: 'employee' as const,
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
 *   前 2 小時：時薪 × (4/3)
 *   第 3 小時起：時薪 × (5/3)
 * 
 * 休息日加班：
 *   前 2 小時：時薪 × (4/3)
 *   第 3-8 小時：時薪 × (5/3)
 *   第 9 小時起：時薪 × (8/3)
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
  if (overtimeType === 'HOLIDAY' || overtimeType === 'MANDATORY_REST') {
    return Math.round(hourlyRate * hours * 2);
  }

  // 平日加班
  if (overtimeType === 'WEEKDAY') {
    if (hours <= 2) {
      return Math.round(hourlyRate * hours * WEEKDAY_FIRST_TWO_HOURS_RATE);
    } else {
      const first2Hours = hourlyRate * 2 * WEEKDAY_FIRST_TWO_HOURS_RATE;
      const remainingHours = hourlyRate * (hours - 2) * WEEKDAY_AFTER_TWO_HOURS_RATE;
      return Math.round(first2Hours + remainingHours);
    }
  }

  // 休息日加班
  if (overtimeType === 'REST_DAY') {
    if (hours <= 2) {
      return Math.round(hourlyRate * hours * WEEKDAY_FIRST_TWO_HOURS_RATE);
    } else if (hours <= 8) {
      const first2Hours = hourlyRate * 2 * WEEKDAY_FIRST_TWO_HOURS_RATE;
      const hours3to8 = hourlyRate * (hours - 2) * WEEKDAY_AFTER_TWO_HOURS_RATE;
      return Math.round(first2Hours + hours3to8);
    } else {
      const first2Hours = hourlyRate * 2 * WEEKDAY_FIRST_TWO_HOURS_RATE;
      const hours3to8 = hourlyRate * 6 * WEEKDAY_AFTER_TWO_HOURS_RATE;
      const hoursAfter8 = hourlyRate * (hours - 8) * REST_DAY_AFTER_EIGHT_HOURS_RATE;
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
  if (overtimeType === 'HOLIDAY' || overtimeType === 'MANDATORY_REST') {
    return `${hourlyRate} × ${hours} × 2 = ${Math.round(hourlyRate * hours * 2)}`;
  }

  if (overtimeType === 'WEEKDAY') {
    if (hours <= 2) {
      return `${hourlyRate} × ${hours} × 4/3 = ${Math.round(hourlyRate * hours * WEEKDAY_FIRST_TWO_HOURS_RATE)}`;
    } else {
      const part1 = Math.round(hourlyRate * 2 * WEEKDAY_FIRST_TWO_HOURS_RATE);
      const part2 = Math.round(hourlyRate * (hours - 2) * WEEKDAY_AFTER_TWO_HOURS_RATE);
      return `(${hourlyRate} × 2 × 4/3 = ${part1}) + (${hourlyRate} × ${hours - 2} × 5/3 = ${part2}) = ${part1 + part2}`;
    }
  }

  if (overtimeType === 'REST_DAY') {
    if (hours <= 2) {
      return `${hourlyRate} × ${hours} × 4/3 = ${Math.round(hourlyRate * hours * WEEKDAY_FIRST_TWO_HOURS_RATE)}`;
    } else if (hours <= 8) {
      const part1 = Math.round(hourlyRate * 2 * WEEKDAY_FIRST_TWO_HOURS_RATE);
      const part2 = Math.round(hourlyRate * (hours - 2) * WEEKDAY_AFTER_TWO_HOURS_RATE);
      return `(${hourlyRate} × 2 × 4/3 = ${part1}) + (${hourlyRate} × ${hours - 2} × 5/3 = ${part2}) = ${part1 + part2}`;
    } else {
      const part1 = Math.round(hourlyRate * 2 * WEEKDAY_FIRST_TWO_HOURS_RATE);
      const part2 = Math.round(hourlyRate * 6 * WEEKDAY_AFTER_TWO_HOURS_RATE);
      const part3 = Math.round(hourlyRate * (hours - 8) * REST_DAY_AFTER_EIGHT_HOURS_RATE);
      return `(${hourlyRate} × 2 × 4/3 = ${part1}) + (${hourlyRate} × 6 × 5/3 = ${part2}) + (${hourlyRate} × ${hours - 8} × 8/3 = ${part3}) = ${part1 + part2 + part3}`;
    }
  }

  return '';
}

/**
 * 調薪（或補登歷史調薪）並在需要時更新員工當前薪資。
 * 歷程與主檔在同一個交易寫入；前一筆薪資依「生效日順序」取，不是拿主檔現薪當基準：
 * - 前薪＝生效日不晚於本筆的最後一筆歷程（同日取較晚建立的）；完全沒有歷程才用主檔現薪
 * - 補登舊日期時，緊接在後的那一筆歷程要改成以本筆為前薪、重算調幅
 * - 主檔現薪只在本筆生效日已到、且沒有更晚且已生效的歷程時才更新（補登舊日期不會蓋掉現在的薪資）
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
  const newHourlyRate = calculateHourlyRate(newBaseSalary);
  const todayText = toTaiwanDateStr(new Date());
  const isEffectiveByToday = (date: Date) => toTaiwanDateStr(date) <= todayText;

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { baseSalary: true }
    });

    if (!employee) {
      return { success: false as const, error: '找不到員工' };
    }

    const earlier = await tx.salaryHistory.findFirst({
      where: { employeeId, effectiveDate: { lte: effectiveDate } },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { baseSalary: true },
    });
    const later = await tx.salaryHistory.findFirst({
      where: { employeeId, effectiveDate: { gt: effectiveDate } },
      orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, effectiveDate: true, baseSalary: true },
    });

    // 沒有更早的歷程：若完全沒有歷程就以主檔現薪為前薪；有更晚的歷程卻沒有更早的（補登比第一筆還早），前薪不明
    const previousSalary = earlier ? earlier.baseSalary : later ? null : employee.baseSalary;
    const adjustmentAmount = previousSalary === null ? null : newBaseSalary - previousSalary;

    const salaryHistory = await tx.salaryHistory.create({
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

    if (later) {
      // 補登在中間：後面那筆的前薪與調幅跟著改成以本筆為基準
      await tx.salaryHistory.update({
        where: { id: later.id },
        data: { previousSalary: newBaseSalary, adjustmentAmount: later.baseSalary - newBaseSalary },
      });
    }

    const supersededByLaterEffective = Boolean(later && isEffectiveByToday(later.effectiveDate));
    const currentSalaryUpdated = isEffectiveByToday(effectiveDate) && !supersededByLaterEffective;
    if (currentSalaryUpdated) {
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          baseSalary: newBaseSalary,
          hourlyRate: newHourlyRate
        }
      });
    }

    return {
      success: true as const,
      salaryHistory,
      previousSalary,
      newBaseSalary,
      adjustmentAmount,
      newHourlyRate,
      currentSalaryUpdated,
    };
  });
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
