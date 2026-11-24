/**
 * 免稅加班費：所得稅申報報表與扣繳憑單共用，兩邊才會對同一個人算出同一個數字。
 *
 * 規則：每月加班不超過 46 小時的加班費免稅。沿用原本的近似公式：
 *   每月免稅上限 = 46 小時 × 當月薪資紀錄上的「平日每小時工資額」（即員工編輯頁的時薪）
 *   當月免稅加班費 = min(當月加班費, 上限)
 *
 * 逐月比較：某個月超限的部分，不能被其他月份沒用完的額度抵銷；
 * 中途調薪時，各月用各自的時薪。
 */
export const TAX_EXEMPT_OVERTIME_MONTHLY_HOURS = 46;

export interface ExemptOvertimeSource {
  overtimePay: number;
  hourlyWage: number;
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateMonthlyExemptOvertimePay(record: ExemptOvertimeSource): number {
  return Math.min(
    nonNegative(record.overtimePay),
    TAX_EXEMPT_OVERTIME_MONTHLY_HOURS * nonNegative(record.hourlyWage)
  );
}

export function sumExemptOvertimePay(records: ExemptOvertimeSource[]): number {
  return records.reduce((sum, record) => sum + calculateMonthlyExemptOvertimePay(record), 0);
}
