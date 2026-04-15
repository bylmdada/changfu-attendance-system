export interface AnnualLeaveYearBreakdown {
  year: number;
  days: number;
}

function normalizeToUtcDate(value: Date | string) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getAnnualLeaveYearBreakdown(
  startValue: Date | string,
  endValue: Date | string
): AnnualLeaveYearBreakdown[] {
  const start = normalizeToUtcDate(startValue);
  const end = normalizeToUtcDate(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const yearlyDays = new Map<number, number>();

  for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    const year = current.getUTCFullYear();
    yearlyDays.set(year, (yearlyDays.get(year) ?? 0) + 1);
  }

  return Array.from(yearlyDays.entries()).map(([year, days]) => ({ year, days }));
}