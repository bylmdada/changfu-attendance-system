export const MONTHLY_BASE_HOURS = 240;

/**
 * 月薪制員工的薪資計算時薪。
 * 依月薪除以 240 小時後四捨五入至整數，供員工管理、薪資管理與薪資計算共用。
 */
export function calculateMonthlySalaryHourlyRate(baseSalary: number): number {
  if (!Number.isFinite(baseSalary) || baseSalary <= 0) {
    return 0;
  }

  return Math.round(baseSalary / MONTHLY_BASE_HOURS);
}

export function calculateMonthlySalaryHourlyRateInput(baseSalary: string | number): number | null {
  const salary = Number(baseSalary);
  if (!Number.isFinite(salary) || salary <= 0) {
    return null;
  }

  return calculateMonthlySalaryHourlyRate(salary);
}
