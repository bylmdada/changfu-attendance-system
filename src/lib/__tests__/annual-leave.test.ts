import { getAnnualLeaveYearBreakdown } from '@/lib/annual-leave';

describe('getAnnualLeaveYearBreakdown', () => {
  it('returns a single yearly bucket for same-year leave ranges', () => {
    expect(
      getAnnualLeaveYearBreakdown(
        new Date('2026-04-01T00:00:00.000Z'),
        new Date('2026-04-03T00:00:00.000Z')
      )
    ).toEqual([
      { year: 2026, days: 3 },
    ]);
  });

  it('splits cross-year leave ranges into per-year buckets', () => {
    expect(
      getAnnualLeaveYearBreakdown(
        new Date('2026-12-31T00:00:00.000Z'),
        new Date('2027-01-02T00:00:00.000Z')
      )
    ).toEqual([
      { year: 2026, days: 1 },
      { year: 2027, days: 2 },
    ]);
  });
});