import {
  buildLeaveReviewRequestBody,
  extractLeaveDatePart,
  formatLeaveDisplayDate,
  getLeaveStatusSortOrder,
} from '../leave-management-helpers';

describe('leave management helpers', () => {
  it('extracts the comparable date part from iso datetime strings', () => {
    expect(extractLeaveDatePart('2026-04-20T09:30:00.000Z')).toBe('2026-04-20');
    expect(extractLeaveDatePart('2026-04-20')).toBe('2026-04-20');
  });

  it('formats leave dates without relying on browser timezone conversion', () => {
    expect(formatLeaveDisplayDate('2026-04-20T09:30:00.000Z')).toBe('2026/04/20');
  });

  it('returns a stable sort order for all leave statuses', () => {
    expect(getLeaveStatusSortOrder('PENDING')).toBeLessThan(getLeaveStatusSortOrder('PENDING_ADMIN'));
    expect(getLeaveStatusSortOrder('PENDING_ADMIN')).toBeLessThan(getLeaveStatusSortOrder('APPROVED'));
    expect(getLeaveStatusSortOrder('UNKNOWN')).toBe(99);
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
