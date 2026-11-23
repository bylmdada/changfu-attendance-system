export interface PayrollStatisticsMonthlyTrend {
  totalGrossPay: number;
  // 該月薪資記錄筆數。有提供時以它判斷該月「有紀錄」（應發為 0 的月份也算）；未提供才退回看金額
  employeeCount?: number;
}

export function countMonthsWithPayroll(monthlyTrends: PayrollStatisticsMonthlyTrend[]): number {
  return monthlyTrends.filter(
    (trend) => (trend.employeeCount ?? (trend.totalGrossPay > 0 ? 1 : 0)) > 0
  ).length;
}

export function calculateAverageMonthlyGrossPay(
  totalGrossPay: number,
  monthlyTrends: PayrollStatisticsMonthlyTrend[]
): number | null {
  const activeMonthCount = countMonthsWithPayroll(monthlyTrends);

  if (activeMonthCount === 0) {
    return null;
  }

  return totalGrossPay / activeMonthCount;
}

export function calculateOvertimePayShare(totalOvertimePay: number, totalGrossPay: number): number {
  if (totalGrossPay <= 0) {
    return 0;
  }

  return (totalOvertimePay / totalGrossPay) * 100;
}
