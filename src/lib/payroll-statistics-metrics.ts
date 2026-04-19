export interface PayrollStatisticsMonthlyTrend {
  totalGrossPay: number;
}

export function countMonthsWithPayroll(monthlyTrends: PayrollStatisticsMonthlyTrend[]): number {
  return monthlyTrends.filter((trend) => trend.totalGrossPay > 0).length;
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
