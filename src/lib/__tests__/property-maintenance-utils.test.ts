import {
  addDays,
  deriveDisplayStatus,
  excelSerialToDate,
  isSameDay,
  monthRange,
  shiftYearMonth,
  startOfDay,
  taipeiYearMonth,
  ymd,
} from '@/lib/property-maintenance-utils';

describe('property-maintenance-utils date handling', () => {
  it('uses the Taipei calendar day for maintenance status boundaries', () => {
    const now = new Date('2026-05-24T01:08:00+08:00');
    const dueAtUtcMidnight = new Date('2026-05-24T00:00:00.000Z');

    expect(ymd(now)).toBe('2026-05-24');
    expect(startOfDay(now).toISOString()).toBe('2026-05-23T16:00:00.000Z');
    expect(isSameDay(now, dueAtUtcMidnight)).toBe(true);
    expect(deriveDisplayStatus('PENDING', dueAtUtcMidnight, now)).toBe('TODAY');
  });

  it('normalizes Excel serial dates to date-only UTC storage values', () => {
    expect(excelSerialToDate(46166)?.toISOString()).toBe('2026-05-24T00:00:00.000Z');
    expect(excelSerialToDate('2026-05-24')?.toISOString()).toBe('2026-05-24T00:00:00.000Z');
  });

  it('adds days without shifting date-only UTC storage values', () => {
    expect(addDays(new Date('2026-05-24T00:00:00.000Z'), 7).toISOString()).toBe(
      '2026-05-31T00:00:00.000Z'
    );
  });

  it('builds stable month ranges and month shifts', () => {
    const range = monthRange(2026, 5);

    expect(range.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(taipeiYearMonth(new Date('2026-05-31T16:30:00.000Z'))).toEqual({
      year: 2026,
      month: 6,
    });
    expect(shiftYearMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});
