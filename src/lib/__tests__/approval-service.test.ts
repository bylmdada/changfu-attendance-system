const mockPrisma = {
  approvalReview: {
    findFirst: jest.fn()
  }
};

jest.mock('@/lib/database', () => ({
  prisma: mockPrisma
}));

import { ensureApprovalReviewAllowed, isTerminalApprovalStatus } from '@/lib/approval-service';

describe('approval review guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('treats approved and rejected instances as terminal', () => {
    expect(isTerminalApprovalStatus('APPROVED')).toBe(true);
    expect(isTerminalApprovalStatus('REJECTED')).toBe(true);
    expect(isTerminalApprovalStatus('LEVEL2_REVIEWING')).toBe(false);
  });

  it('rejects reviews for terminal instances', async () => {
    await expect(
      ensureApprovalReviewAllowed(
        mockPrisma as never,
        { id: 1, currentLevel: 2, status: 'APPROVED' },
        99
      )
    ).rejects.toThrow('此審核已完成，無法再次審核');
    expect(mockPrisma.approvalReview.findFirst).not.toHaveBeenCalled();
  });

  it('rejects duplicate reviews by the same reviewer on the same level', async () => {
    mockPrisma.approvalReview.findFirst.mockResolvedValue({ id: 123 });

    await expect(
      ensureApprovalReviewAllowed(
        mockPrisma as never,
        { id: 1, currentLevel: 2, status: 'LEVEL2_REVIEWING' },
        99
      )
    ).rejects.toThrow('您已完成此關卡審核，請勿重複送出');
  });

  it('allows a fresh review on an active instance', async () => {
    mockPrisma.approvalReview.findFirst.mockResolvedValue(null);

    await expect(
      ensureApprovalReviewAllowed(
        mockPrisma as never,
        { id: 1, currentLevel: 2, status: 'LEVEL2_REVIEWING' },
        99
      )
    ).resolves.toBeUndefined();
    expect(mockPrisma.approvalReview.findFirst).toHaveBeenCalledWith({
      where: {
        instanceId: 1,
        reviewerId: 99,
        level: 2
      },
      select: { id: true }
    });
  });
});