import {
  addDays,
  buildLegacyRecordId,
  buildRecordId,
  deriveDisplayStatus,
  excelSerialToDate,
  generatedRecordIds,
  getNextMaintenanceDate,
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

    expect(range.start.toISOString()).toBe('2026-04-30T16:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-05-31T16:00:00.000Z');
    expect(taipeiYearMonth(new Date('2026-05-31T16:30:00.000Z'))).toEqual({
      year: 2026,
      month: 6,
    });
    expect(shiftYearMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('schedules the next maintenance from the completion date by calendar month', () => {
    // 0106030701-0010：每月一次，2026-11-04 深夜完成 → 2026-12-04
    expect(ymd(getNextMaintenanceDate(new Date('2026-11-04T23:30:00+08:00'), '每月一次', 28))).toBe('2026-12-04');
    expect(ymd(getNextMaintenanceDate(new Date('2026-01-31T10:00:00+08:00'), '每月一次', 28))).toBe('2026-02-28');
    expect(ymd(getNextMaintenanceDate(new Date('2026-11-30T10:00:00+08:00'), '每季一次', 90))).toBe('2027-02-28');
    expect(ymd(getNextMaintenanceDate(new Date('2026-11-04T10:00:00+08:00'), '每週一次', 7))).toBe('2026-11-11');
    expect(getNextMaintenanceDate(new Date('2026-11-04T10:00:00+08:00'), '每月一次', 28).toISOString())
      .toBe('2026-12-03T16:00:00.000Z');
  });

  it('builds record ids that stay distinct for same-code assets of different sites', () => {
    const due = new Date('2026-11-23T16:00:00.000Z'); // 台北 2026-11-24

    expect(buildLegacyRecordId('A001', due)).toBe('M-2026-11-24-A001');
    // 兩個據點的 A001 同日到期：紀錄ID 不可相同
    expect(buildRecordId('A001', due, 7)).toBe('M-2026-11-24-A001~7');
    expect(buildRecordId('A001', due, 8)).toBe('M-2026-11-24-A001~8');
    // 同一資產同一天永遠產生同一個 ID，才能用唯一鍵去重
    expect(buildRecordId('A001', due, 7)).toBe(buildRecordId('A001', due, 7));
  });

  it('lists both the legacy and the current id used to detect an already generated task', () => {
    expect(generatedRecordIds({ id: 7, assetCode: 'A001' }, new Date('2026-11-23T16:00:00.000Z'))).toEqual([
      'M-2026-11-24-A001',
      'M-2026-11-24-A001~7',
    ]);
  });
});
