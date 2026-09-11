export interface AnnualLeaveYearBreakdown {
  year: number;
  days: number;
}

function normalizeToUtcDate(value: Date | string) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Only for reversing approvals made before accounting snapshots were introduced.
export function getLegacyAnnualLeaveYearBreakdown(
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

export function getAnnualLeaveYearBreakdown(hoursByDate: Record<string, number>): AnnualLeaveYearBreakdown[] {
  const yearlyDays = new Map<number, number>();
  for (const [date, hours] of Object.entries(hoursByDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hours) || hours < 0) {
      throw new Error('特休扣帳資料無效');
    }
    const year = Number(date.slice(0, 4));
    yearlyDays.set(year, (yearlyDays.get(year) ?? 0) + hours / 8);
  }
  return [...yearlyDays].map(([year, days]) => ({ year, days }));
}
