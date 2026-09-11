import { getLegacyAnnualLeaveYearBreakdown } from '@/lib/annual-leave';

describe('getLegacyAnnualLeaveYearBreakdown', () => {
  it('returns a single yearly bucket for same-year leave ranges', () => {
    expect(
      getLegacyAnnualLeaveYearBreakdown(
        new Date('2026-04-01T00:00:00.000Z'),
        new Date('2026-04-03T00:00:00.000Z')
      )
    ).toEqual([
      { year: 2026, days: 3 },
    ]);
  });

  it('splits cross-year leave ranges into per-year buckets', () => {
    expect(
      getLegacyAnnualLeaveYearBreakdown(
        new Date('2026-12-31T00:00:00.000Z'),
        new Date('2027-01-02T00:00:00.000Z')
      )
    ).toEqual([
      { year: 2026, days: 1 },
      { year: 2027, days: 2 },
    ]);
  });
});
import { getAnnualLeaveYearBreakdown } from '@/lib/annual-leave';
test('accounts partial hours by Taiwan work date and year', () => {
  expect(getAnnualLeaveYearBreakdown({'2026-09-11':4})).toEqual([{year:2026,days:0.5}]);
  expect(getAnnualLeaveYearBreakdown({'2027-01-01':8})).toEqual([{year:2027,days:1}]);
  expect(getAnnualLeaveYearBreakdown({'2026-12-31':2,'2027-01-01':4})).toEqual([{year:2026,days:0.25},{year:2027,days:0.5}]);
  expect(getAnnualLeaveYearBreakdown({'2026-09-11':5/60})[0].days).toBeCloseTo(5/480, 8);
});
