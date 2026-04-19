jest.mock('@/lib/database', () => ({
  prisma: {
    approvalInstance: {
      findUnique: jest.fn(),
      updateMany: jest.fn()
    },
    approvalReview: {
      findFirst: jest.fn(),
      create: jest.fn()
    },
    employee: {
      findUnique: jest.fn()
    },
    $transaction: jest.fn()
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/approval-helper', () => ({
  updateRequestStatus: jest.fn()
}));

jest.mock('@/lib/approval-notifications', () => ({
  notifyApplicant: jest.fn(),
  notifyReviewers: jest.fn()
}));

jest.mock('@/lib/approval-service', () => {
  const actual = jest.requireActual('@/lib/approval-service');

  return {
    ...actual,
    ensureApprovalReviewAllowed: jest.fn(),
    isReviewerFor: jest.fn()
  };
});

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { ensureApprovalReviewAllowed, isReviewerFor } from '@/lib/approval-service';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockEnsureApprovalReviewAllowed = ensureApprovalReviewAllowed as jest.MockedFunction<typeof ensureApprovalReviewAllowed>;
const mockIsReviewerFor = isReviewerFor as jest.MockedFunction<typeof isReviewerFor>;

describe('approval instances route authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockEnsureApprovalReviewAllowed.mockResolvedValue();
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '代理主管' } as never);
    mockPrisma.approvalReview.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma as never) as never);
  });

  it('allows deputy reviewers to approve level-one instances shown in the dashboard', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 51, username: 'deputy.user' } as never);
    mockPrisma.approvalInstance.findUnique.mockResolvedValue({
      id: 9,
      requestType: 'LEAVE',
      requestId: 88,
      applicantId: 7,
      applicantName: '申請人',
      department: 'Operations',
      currentLevel: 1,
      maxLevel: 3,
      status: 'LEVEL1_REVIEWING',
      deadlineAt: null
    } as never);
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'DEPUTY' });

    const request = new NextRequest('http://localhost/api/approval-instances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: 9,
        action: 'APPROVE',
        comment: '代理審核通過'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockIsReviewerFor).toHaveBeenCalledWith(51, 'Operations', 'LEAVE');
    expect(mockPrisma.approvalReview.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewerRole: 'DEPUTY' })
    }));
  });

  it('rejects unrelated employees from approving level-one instances', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 99, username: 'random.user' } as never);
    mockPrisma.approvalInstance.findUnique.mockResolvedValue({
      id: 9,
      requestType: 'LEAVE',
      requestId: 88,
      applicantId: 7,
      applicantName: '申請人',
      department: 'Operations',
      currentLevel: 1,
      maxLevel: 3,
      status: 'LEVEL1_REVIEWING',
      deadlineAt: null
    } as never);
    mockIsReviewerFor.mockResolvedValue({ isReviewer: false, role: null });

    const request = new NextRequest('http://localhost/api/approval-instances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: 9,
        action: 'APPROVE'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('您不是此部門的審核者');
    expect(mockPrisma.approvalReview.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before reading approval review payloads', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 51, username: 'admin.user' } as never);

    const request = new NextRequest('http://localhost/api/approval-instances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"instanceId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.approvalInstance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.approvalReview.create).not.toHaveBeenCalled();
  });

  it('rejects null JSON bodies before reading approval review payloads', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 51, username: 'admin.user' } as never);

    const request = new NextRequest('http://localhost/api/approval-instances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的審核資料');
    expect(mockPrisma.approvalInstance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.approvalReview.create).not.toHaveBeenCalled();
  });

  it('finalizes one-level approvals instead of incorrectly forwarding them to level two', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 51, username: 'admin.user' } as never);
    mockPrisma.approvalInstance.findUnique.mockResolvedValue({
      id: 10,
      requestType: 'ANNOUNCEMENT',
      requestId: 99,
      applicantId: 7,
      applicantName: '申請人',
      department: 'Operations',
      currentLevel: 1,
      maxLevel: 1,
      status: 'LEVEL1_REVIEWING',
      deadlineAt: null,
    } as never);

    const request = new NextRequest('http://localhost/api/approval-instances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: 10,
        action: 'APPROVE',
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.newStatus).toBe('APPROVED');
    expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'APPROVED',
        currentLevel: 1,
      })
    }));
  });

  it('finalizes two-level approvals at the second level instead of incorrectly creating a third level', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 51, username: 'hr.user' } as never);
    mockPrisma.approvalInstance.findUnique.mockResolvedValue({
      id: 11,
      requestType: 'LEAVE',
      requestId: 100,
      applicantId: 7,
      applicantName: '申請人',
      department: 'Operations',
      currentLevel: 2,
      maxLevel: 2,
      status: 'LEVEL2_REVIEWING',
      deadlineAt: null,
    } as never);

    const request = new NextRequest('http://localhost/api/approval-instances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: 11,
        action: 'APPROVE',
        comment: '二階核准',
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.newStatus).toBe('APPROVED');
    expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'APPROVED',
        currentLevel: 2,
      })
    }));
  });
});
