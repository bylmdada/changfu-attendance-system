import { getTaiwanDateParts, getTaiwanTimeParts, toTaiwanDateStr } from '@/lib/timezone';

describe('Taiwan date and time parts', () => {
  it('converts instants around the Taipei midnight boundary', () => {
    // 台北 2026-11-20 00:00 = UTC 2026-11-19 16:00
    expect(getTaiwanDateParts(new Date('2026-11-19T15:59:59.999Z'))).toEqual({ year: 2026, month: 11, day: 19 });
    expect(getTaiwanDateParts(new Date('2026-11-19T16:00:00.000Z'))).toEqual({ year: 2026, month: 11, day: 20 });
    expect(toTaiwanDateStr(new Date('2026-12-31T16:00:00.000Z'))).toBe('2027-01-01');
  });

  it('uses a 24-hour clock without a 24:00 hour', () => {
    expect(getTaiwanTimeParts(new Date('2026-11-19T16:00:00.000Z'))).toEqual({ hour: 0, minute: 0 });
    expect(getTaiwanTimeParts(new Date('2026-11-20T00:05:00.000Z'))).toEqual({ hour: 8, minute: 5 });
    expect(getTaiwanTimeParts(new Date('2026-11-20T15:59:00.000Z'))).toEqual({ hour: 23, minute: 59 });
  });

  it('rejects invalid dates instead of returning NaN parts', () => {
    expect(() => getTaiwanDateParts(new Date('not a date'))).toThrow();
    expect(() => getTaiwanTimeParts(new Date('not a date'))).toThrow();
  });

  it('reuses its formatters: building an Intl.DateTimeFormat per call made 2,400 attendance rows take ~3 seconds', () => {
    const construct = jest.spyOn(Intl, 'DateTimeFormat');
    try {
      for (let i = 0; i < 500; i++) {
        const instant = new Date(Date.UTC(2026, 0, 1) + i * 3_600_000);
        getTaiwanDateParts(instant);
        getTaiwanTimeParts(instant);
        toTaiwanDateStr(instant);
      }
      expect(construct).not.toHaveBeenCalled();
    } finally {
      construct.mockRestore();
    }
  });
});
