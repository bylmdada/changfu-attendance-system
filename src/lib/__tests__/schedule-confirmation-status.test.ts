import {
  SCHEDULE_ALL_DEPARTMENTS,
  pickApplicableScheduleRelease,
} from '@/lib/schedule-confirmation-status';

describe('applicable schedule release', () => {
  it('prefers a department release over a newer company-wide release', () => {
    const release = pickApplicableScheduleRelease([
      { id: 1, department: null, publishedAt: new Date('2026-07-31T12:00:00Z'), version: 3 },
      { id: 2, department: '行政部', publishedAt: new Date('2026-07-30T12:00:00Z'), version: 1 },
    ], '行政部');

    expect(release?.id).toBe(2);
  });

  it('treats the non-null all-company sentinel as a global release', () => {
    const release = pickApplicableScheduleRelease([
      { id: 3, department: SCHEDULE_ALL_DEPARTMENTS, publishedAt: new Date('2026-07-31T12:00:00Z'), version: 1 },
    ], '護理部');

    expect(release?.id).toBe(3);
  });
});
