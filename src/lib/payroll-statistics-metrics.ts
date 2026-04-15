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