export interface PayrollStatisticsFilters {
  year: string;
  month: string;
  department: string;
}

export function buildPayrollStatisticsRequest(
  origin: string,
  filters: PayrollStatisticsFilters
): { url: string; options: RequestInit } {
  const url = new URL('/api/payroll/statistics', origin);

  if (filters.year) {
    url.searchParams.set('year', filters.year);
  }

  if (filters.month) {
    url.searchParams.set('month', filters.month);
  }

  if (filters.department) {
    url.searchParams.set('department', filters.department);
  }

  return {
    url: url.toString(),
    options: {
      credentials: 'include'
    }
  };
}