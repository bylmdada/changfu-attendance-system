import { overlapsTaiwanDateRange, parseTaiwanDayRange } from '../date-range-query';

describe('parseTaiwanDayRange', () => {
  it('returns the Taipei day bounds', () => {
    expect(parseTaiwanDayRange('2026-12-01')).toEqual({
      start: new Date('2026-11-30T16:00:00.000Z'),
      end: new Date('2026-12-01T15:59:59.999Z'),
    });
  });

  it('rejects malformed or non-existent dates', () => {
    expect(parseTaiwanDayRange('')).toBeNull();
    expect(parseTaiwanDayRange('2026/12/01')).toBeNull();
    expect(parseTaiwanDayRange('2026-02-31')).toBeNull();
    expect(parseTaiwanDayRange('abc')).toBeNull();
  });
});

describe('overlapsTaiwanDateRange', () => {
  // 十二月：2026-12-01 ～ 2026-12-31
  const inDecember = (start: string, end: string) =>
    overlapsTaiwanDateRange(start, end, '2026-12-01', '2026-12-31');

  it('includes leaves that cross either edge of the period', () => {
    expect(inDecember('2026-11-30T01:00:00.000Z', '2026-12-02T09:00:00.000Z')).toBe(true); // 11/30–12/02
    expect(inDecember('2026-12-30T01:00:00.000Z', '2027-01-02T09:00:00.000Z')).toBe(true); // 12/30–1/2
  });

  it('excludes records that end before or start after the period', () => {
    expect(inDecember('2026-11-29T01:00:00.000Z', '2026-11-30T09:00:00.000Z')).toBe(false); // 11/30 結束
    expect(inDecember('2027-01-01T01:00:00.000Z', '2027-01-02T09:00:00.000Z')).toBe(false);
  });

  it('keeps single-day records on the first and last day of the period', () => {
    expect(inDecember('2026-12-01T01:00:00.000Z', '2026-12-01T09:00:00.000Z')).toBe(true);
    expect(inDecember('2026-12-31T01:00:00.000Z', '2026-12-31T09:00:00.000Z')).toBe(true);
  });

  it('compares Taipei dates, not UTC dates', () => {
    // 台北 12/01 07:30 = UTC 11/30 23:30：算十二月的第一天
    expect(inDecember('2026-11-30T23:30:00.000Z', '2026-12-01T09:00:00.000Z')).toBe(true);
    // 台北 12/01 00:30 結束 = UTC 11/30 16:30：12/01 的紀錄，不是 11/30
    expect(overlapsTaiwanDateRange('2026-11-30T14:00:00.000Z', '2026-11-30T16:30:00.000Z', '2026-12-01', '2026-12-31')).toBe(true);
    expect(overlapsTaiwanDateRange('2026-11-30T14:00:00.000Z', '2026-11-30T15:59:00.000Z', '2026-12-01', '2026-12-31')).toBe(false);
  });

  it('applies the start and end bounds independently', () => {
    const nov01 = '2026-11-01T00:00:00.000Z';
    const nov20 = '2026-11-20T00:00:00.000Z';

    expect(overlapsTaiwanDateRange(nov01, nov01, '2026-11-15', undefined)).toBe(false);
    expect(overlapsTaiwanDateRange(nov20, nov20, '2026-11-15', undefined)).toBe(true);
    expect(overlapsTaiwanDateRange(nov01, nov01, undefined, '2026-11-15')).toBe(true);
    expect(overlapsTaiwanDateRange(nov20, nov20, undefined, '2026-11-15')).toBe(false);
    expect(overlapsTaiwanDateRange(nov01, nov01, '', '')).toBe(true);
  });

  it('includes a record on the selected day itself', () => {
    const nov15 = '2026-11-15T00:00:00.000Z'; // 加班日期存成 UTC 午夜，台北 08:00
    expect(overlapsTaiwanDateRange(nov15, nov15, '2026-11-15', undefined)).toBe(true);
    expect(overlapsTaiwanDateRange(nov15, nov15, undefined, '2026-11-15')).toBe(true);
    expect(overlapsTaiwanDateRange(nov15, nov15, '2026-11-15', '2026-11-15')).toBe(true);
  });

  it('does not match records with unreadable dates', () => {
    expect(overlapsTaiwanDateRange('not-a-date', '2026-12-01', '2026-12-01', undefined)).toBe(false);
  });
});
