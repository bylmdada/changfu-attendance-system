jest.mock('@/lib/database', () => ({
  prisma: {
    approvalInstance: {
      findFirst: jest.fn()
    },
    resignationRecord: {
      findUnique: jest.fn()
    },
    user: {
      findUnique: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/approval-service', () => ({
  isReviewerFor: jest.fn()
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { isReviewerFor } from '@/lib/approval-service';
import { getApprovalWorkflow } from '@/lib/approval-workflow';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockIsReviewerFor = isReviewerFor as jest.MockedFunction<typeof isReviewerFor>;
const mockGetApprovalWorkflow = getApprovalWorkflow as jest.MockedFunction<typeof getApprovalWorkflow>;

describe('approval reviews route authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsReviewerFor.mockResolvedValue({ isReviewer: false, role: null });
    mockGetApprovalWorkflow.mockResolvedValue({
      workflowType: 'LEAVE',
      workflowName: '請假',
      approvalLevel: 2,
      requireManager: true,
      finalApprover: 'ADMIN',
      enableForward: false,
      enableCC: false,
    } as never);
  });

  it('uses workflow-configured level count when no approval instance exists yet', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 1 } as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue(null as never);
    mockGetApprovalWorkflow.mockResolvedValue({
      workflowType: 'LEAVE',
      workflowName: '請假',
      approvalLevel: 1,
      requireManager: false,
      finalApprover: 'ADMIN',
      enableForward: false,
      enableCC: false,
    } as never);

    const request = new NextRequest('http://localhost/api/approval-reviews?requestType=LEAVE&requestId=7');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      currentLevel: 1,
      maxLevel: 1,
      status: 'PENDING',
      reviews: []
    });
    expect(mockGetApprovalWorkflow).toHaveBeenCalledWith('LEAVE', { department: null });
  });

  it('returns 403 when the authenticated employee is neither applicant nor reviewer', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 99 } as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue({
      applicantId: 1,
      department: 'Operations',
      requestType: 'LEAVE',
      currentLevel: 2,
      maxLevel: 3,
      status: 'LEVEL2_REVIEWING',
      reviews: []
    } as never);

    const request = new NextRequest('http://localhost/api/approval-reviews?requestType=LEAVE&requestId=7');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('無權查看此審核歷程');
    expect(mockIsReviewerFor).toHaveBeenCalledWith(99, 'Operations', 'LEAVE');
  });

  it('allows the applicant to view their own review history', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 1 } as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue({
      applicantId: 1,
      department: 'Operations',
      requestType: 'LEAVE',
      currentLevel: 2,
      maxLevel: 3,
      status: 'LEVEL2_REVIEWING',
      reviews: [
        {
          level: 1,
          reviewerName: '主管甲',
          reviewerRole: 'MANAGER',
          action: 'APPROVE',
          comment: '同意',
          createdAt: new Date('2026-04-08T08:00:00.000Z')
        }
      ]
    } as never);

    const request = new NextRequest('http://localhost/api/approval-reviews?requestType=LEAVE&requestId=7');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.reviews).toHaveLength(1);
    expect(mockIsReviewerFor).not.toHaveBeenCalled();
  });

  it('allows department reviewers to view review history', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 18 } as never);
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' });
    mockPrisma.approvalInstance.findFirst.mockResolvedValue({
      applicantId: 1,
      department: 'Operations',
      requestType: 'LEAVE',
      currentLevel: 1,
      maxLevel: 3,
      status: 'LEVEL1_REVIEWING',
      reviews: []
    } as never);

    const request = new NextRequest('http://localhost/api/approval-reviews?requestType=LEAVE&requestId=7');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockIsReviewerFor).toHaveBeenCalledWith(18, 'Operations', 'LEAVE');
  });
  describe('離職單沒有流程實例時（改版前的核准／駁回）', () => {
    const getHistory = () =>
      GET(new NextRequest('http://localhost/api/approval-reviews?requestType=RESIGNATION&requestId=5'));
    const record = (overrides: Record<string, unknown> = {}) => ({
      employeeId: 10,
      status: 'APPROVED',
      approvedById: 3,
      approvedAt: new Date('2026-11-10T02:30:00.000Z'),
      rejectionReason: null,
      notes: '請完成交接',
      employee: { department: '照護部' },
      ...overrides,
    });

    beforeEach(() => {
      mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 2 } as never);
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null as never);
      mockPrisma.user.findUnique.mockResolvedValue({
        username: 'hr01',
        role: 'HR',
        employee: { name: '人資甲' },
      } as never);
      mockGetApprovalWorkflow.mockResolvedValue({ approvalLevel: 2, requireManager: true } as never);
    });

    it('shows the stored decision, reviewer and time instead of an empty pending history', async () => {
      mockPrisma.resignationRecord.findUnique.mockResolvedValue(record() as never);

      const response = await getHistory();
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        success: true,
        currentLevel: 2,
        maxLevel: 2,
        status: 'APPROVED',
        reviews: [
          {
            level: 2,
            reviewerName: '人資甲',
            reviewerRole: 'HR',
            status: 'APPROVED',
            comment: '請完成交接',
            reviewedAt: '2026-11-10T02:30:00.000Z',
          },
        ],
      });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 } }));
    });

    it('shows a rejection with its reason', async () => {
      mockPrisma.resignationRecord.findUnique.mockResolvedValue(
        record({ status: 'REJECTED', rejectionReason: '交接期不足', notes: null }) as never
      );

      const payload = await (await getHistory()).json();

      expect(payload.status).toBe('REJECTED');
      expect(payload.reviews[0]).toEqual(expect.objectContaining({ status: 'REJECTED', comment: '交接期不足' }));
    });

    it('keeps showing the original approval once the resignation is in handover', async () => {
      mockPrisma.resignationRecord.findUnique.mockResolvedValue(record({ status: 'IN_HANDOVER' }) as never);

      const payload = await (await getHistory()).json();

      expect(payload.status).toBe('APPROVED');
      expect(payload.reviews).toHaveLength(1);
    });

    it('still answers pending with no reviews while the resignation has no decision yet', async () => {
      mockPrisma.resignationRecord.findUnique.mockResolvedValue(
        record({ status: 'PENDING', approvedById: null, approvedAt: null, notes: null }) as never
      );

      const payload = await (await getHistory()).json();

      expect(payload).toEqual({ success: true, currentLevel: 1, maxLevel: 2, status: 'PENDING', reviews: [] });
    });

    it('lets the applicant see their own decision but not other employees', async () => {
      mockPrisma.resignationRecord.findUnique.mockResolvedValue(record() as never);

      mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 10 } as never);
      expect((await getHistory()).status).toBe(200);

      mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 99 } as never);
      const denied = await getHistory();
      expect(denied.status).toBe(403);
      expect((await denied.json()).error).toBe('無權查看此審核歷程');
    });
  });
});
