import {
  buildLeaveReviewRequestBody,
  calculateLeaveDuration,
  calculateLeaveHoursByDate,
  deriveLeaveHours,
  extractLeaveDatePart,
  formatLeaveDisplayDate,
  formatLeaveDays,
  formatLeaveDurationSummary,
  formatLeaveHours,
  getLeaveStatusSortOrder,
  leaveRangesOverlap,
} from '../leave-management-helpers';

describe('leave management helpers', () => {
  it('extracts the comparable date part from iso datetime strings', () => {
    expect(extractLeaveDatePart('2026-04-20T09:30:00.000Z')).toBe('2026-04-20');
    expect(extractLeaveDatePart('2026-04-20')).toBe('2026-04-20');
  });

  it('formats leave dates without relying on browser timezone conversion', () => {
    expect(formatLeaveDisplayDate('2026-04-20T09:30:00.000Z')).toBe('2026/04/20');
  });

  it('derives and formats leave duration values consistently', () => {
    expect(deriveLeaveHours(0.5)).toBe(4);
    expect(formatLeaveDays(0.125)).toBe('0.125 天');
    expect(formatLeaveHours(4)).toBe('4 小時');
    expect(formatLeaveDurationSummary(12)).toBe('1 天 4 小時');
    expect(formatLeaveDurationSummary(2)).toBe('2 小時');
  });

  it('calculates leave duration from date and time ranges', () => {
    expect(
      calculateLeaveDuration({
        startDate: '2026-06-23',
        endDate: '2026-06-23',
        startHour: '08',
        startMinute: '00',
        endHour: '12',
        endMinute: '00',
      })
    ).toEqual({
      totalDays: 0.5,
      totalHours: 4,
    });

    expect(
      calculateLeaveDuration({
        startDate: '2026-06-23',
        endDate: '2026-06-23',
        startHour: '12',
        startMinute: '00',
        endHour: '08',
        endMinute: '00',
      })
    ).toBeNull();
  });

  it('deducts scheduled break time when leave covers a full shift', () => {
    expect(
      calculateLeaveDuration(
        {
          startDate: '2026-07-02',
          endDate: '2026-07-02',
          startHour: '08',
          startMinute: '00',
          endHour: '17',
          endMinute: '00',
        },
        {
          '2026-07-02': {
            shiftType: 'B',
            startTime: '08:00',
            endTime: '17:00',
            breakTime: 60,
            workHours: 8,
          },
        }
      )
    ).toEqual({
      totalDays: 1,
      totalHours: 8,
    });
  });

  it('returns paid leave hours per work date', () => {
    expect(calculateLeaveHoursByDate({
      startDate: '2026-07-02',
      endDate: '2026-07-02',
      startHour: '08',
      startMinute: '00',
      endHour: '17',
      endMinute: '00',
    }, {
      '2026-07-02': {
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 60,
        workHours: 8,
      },
    })).toEqual({ '2026-07-02': 8 });
  });

  it('returns a stable sort order for all leave statuses', () => {
    expect(getLeaveStatusSortOrder('PENDING')).toBeLessThan(getLeaveStatusSortOrder('PENDING_ADMIN'));
    expect(getLeaveStatusSortOrder('PENDING_ADMIN')).toBeLessThan(getLeaveStatusSortOrder('APPROVED'));
    expect(getLeaveStatusSortOrder('UNKNOWN')).toBe(99);
  });

  it('treats adjacent leave time ranges as non-overlapping', () => {
    expect(
      leaveRangesOverlap(
        new Date('2026-07-08T15:00:00'),
        new Date('2026-07-08T16:00:00'),
        new Date('2026-07-08T16:00:00'),
        new Date('2026-07-08T17:00:00')
      )
    ).toBe(false);

    expect(
      leaveRangesOverlap(
        new Date('2026-07-08T15:00:00'),
        new Date('2026-07-08T16:01:00'),
        new Date('2026-07-08T16:00:00'),
        new Date('2026-07-08T17:00:00')
      )
    ).toBe(true);
  });

  it('uses final approval payloads for admin approvals even if manager flags exist', () => {
    expect(
      buildLeaveReviewRequestBody('APPROVED', {
        canFinalApprove: true,
        canSubmitManagerOpinion: true,
      })
    ).toEqual({ status: 'APPROVED' });

    expect(
      buildLeaveReviewRequestBody('REJECTED', {
        canFinalApprove: false,
        canSubmitManagerOpinion: true,
      })
    ).toEqual({ opinion: 'DISAGREE' });
  });
});
