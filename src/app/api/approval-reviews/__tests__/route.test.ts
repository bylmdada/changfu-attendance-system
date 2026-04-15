jest.mock('@/lib/database', () => ({
  prisma: {
    approvalInstance: {
      findFirst: jest.fn()
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
    expect(mockGetApprovalWorkflow).toHaveBeenCalledWith('LEAVE');
  });

  it('returns 403 when the authenticated employee is neither applicant nor reviewer', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 99 } as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue({
      applicantId: 1,
      department: 'Operations',
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
    expect(mockIsReviewerFor).toHaveBeenCalledWith(99, 'Operations');
  });

  it('allows the applicant to view their own review history', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 1 } as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue({
      applicantId: 1,
      department: 'Operations',
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
    expect(mockIsReviewerFor).toHaveBeenCalledWith(18, 'Operations');
  });
});