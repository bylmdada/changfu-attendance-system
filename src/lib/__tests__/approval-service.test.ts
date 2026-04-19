const mockPrisma = {
  approvalReview: {
    findFirst: jest.fn()
  },
  approvalWorkflow: {
    findUnique: jest.fn()
  },
  approvalInstance: {
    create: jest.fn()
  },
  departmentManager: {
    findFirst: jest.fn(),
    findMany: jest.fn()
  },
  managerDeputy: {
    findFirst: jest.fn()
  },
  approvalDelegate: {
    findMany: jest.fn()
  }
};

jest.mock('@/lib/database', () => ({
  prisma: mockPrisma
}));

import {
  createApprovalInstance,
  determineApprovalTransition,
  ensureApprovalReviewAllowed,
  getDepartmentManager,
  isReviewerFor,
  isTerminalApprovalStatus
} from '@/lib/approval-service';

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

  it('approves immediately when the current level is already the configured final level', () => {
    expect(
      determineApprovalTransition(1, 1, 'APPROVE', 'ADMIN', 'LEVEL1_REVIEWING' as never)
    ).toEqual({
      newStatus: 'APPROVED',
      newLevel: 1,
    });

    expect(
      determineApprovalTransition(2, 2, 'APPROVE', 'HR', 'LEVEL2_REVIEWING' as never)
    ).toEqual({
      newStatus: 'APPROVED',
      newLevel: 2,
    });
  });

  it('loads department managers with deputies constrained by both start and end dates', async () => {
    mockPrisma.departmentManager.findFirst.mockResolvedValue(null);

    await getDepartmentManager('Operations');

    expect(mockPrisma.departmentManager.findFirst).toHaveBeenCalledWith({
      where: {
        department: 'Operations',
        isPrimary: true,
        isActive: true
      },
      include: {
        employee: {
          select: { id: true, name: true }
        },
        deputies: {
          where: {
            isActive: true,
            AND: [
              {
                OR: [
                  { startDate: null },
                  { startDate: { lte: expect.any(Date) } }
                ]
              },
              {
                OR: [
                  { endDate: null },
                  { endDate: { gte: expect.any(Date) } }
                ]
              }
            ]
          },
          include: {
            deputyEmployee: {
              select: { id: true, name: true }
            }
          }
        }
      }
    });
  });

  it('treats active approval delegates as level-one reviewers when the request type matches', async () => {
    mockPrisma.departmentManager.findFirst.mockResolvedValueOnce(null);
    mockPrisma.managerDeputy.findFirst.mockResolvedValue(null);
    mockPrisma.approvalDelegate.findMany.mockResolvedValue([
      { delegatorId: 5, resourceTypes: JSON.stringify(['LEAVE']) }
    ]);
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { employeeId: 5, department: 'Operations' }
    ]);

    await expect(isReviewerFor(99, 'Operations', 'LEAVE')).resolves.toEqual({
      isReviewer: true,
      role: 'DEPUTY'
    });
  });

  it('does not grant approval-delegate access for request types outside the delegated scope', async () => {
    mockPrisma.departmentManager.findFirst.mockResolvedValueOnce(null);
    mockPrisma.managerDeputy.findFirst.mockResolvedValue(null);
    mockPrisma.approvalDelegate.findMany.mockResolvedValue([
      { delegatorId: 5, resourceTypes: JSON.stringify(['LEAVE']) }
    ]);
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { employeeId: 5, department: 'Operations' }
    ]);

    await expect(isReviewerFor(99, 'Operations', 'PURCHASE')).resolves.toEqual({
      isReviewer: false,
      role: null
    });
  });

  it('creates direct-admin instances as single-stage level-one reviews', async () => {
    mockPrisma.approvalWorkflow.findUnique.mockResolvedValue({
      approvalLevel: 3,
      requireManager: false,
      finalApprover: 'MANAGER',
      deadlineMode: 'FIXED',
      deadlineHours: 24
    });
    mockPrisma.approvalInstance.create.mockResolvedValue({ id: 55 });

    await createApprovalInstance({
      requestType: 'ANNOUNCEMENT',
      requestId: 8,
      applicantId: 5,
      applicantName: '申請人',
      department: 'Operations'
    });

    expect(mockPrisma.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currentLevel: 1,
        maxLevel: 1,
        requireManager: false,
        status: 'LEVEL1_REVIEWING'
      })
    });
  });
});
