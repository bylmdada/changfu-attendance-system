jest.mock('@/lib/database', () => ({
  prisma: {
    approvalCC: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    },
    approvalInstance: {
      findUnique: jest.fn()
    },
    employee: {
      findUnique: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/approval-service', () => ({
  isReviewerFor: jest.fn(),
  isTerminalApprovalStatus: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { isReviewerFor, isTerminalApprovalStatus } from '@/lib/approval-service';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockIsReviewerFor = isReviewerFor as jest.MockedFunction<typeof isReviewerFor>;
const mockIsTerminalApprovalStatus = isTerminalApprovalStatus as jest.MockedFunction<typeof isTerminalApprovalStatus>;

describe('approval cc route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockIsReviewerFor.mockResolvedValue({ isReviewer: false, role: null });
    mockIsTerminalApprovalStatus.mockReturnValue(false);
  });

  it('rejects create requests from employees who are not authorized reviewers', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 88 } as never);
    mockPrisma.approvalInstance.findUnique.mockResolvedValue({
      id: 15,
      currentLevel: 2,
      department: 'Operations',
      status: 'LEVEL2_REVIEWING'
    } as never);

    const request = new NextRequest('http://localhost/api/approval-cc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'CREATE',
        instanceId: 15,
        ccToEmployeeId: 9,
        ccToName: '王小明'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('無權為此審核建立 CC');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.approvalCC.create).not.toHaveBeenCalled();
  });

  it('allows level-one department reviewers to create cc entries', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 18 } as never);
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' });
    mockPrisma.approvalInstance.findUnique.mockResolvedValue({
      id: 15,
      currentLevel: 1,
      requestType: 'LEAVE',
      department: 'Operations',
      status: 'LEVEL1_REVIEWING'
    } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 18, name: '部門主管' } as never);
    mockPrisma.approvalCC.create.mockResolvedValue({ id: 100 } as never);

    const request = new NextRequest('http://localhost/api/approval-cc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'CREATE',
        instanceId: 15,
        ccToEmployeeId: 9,
        ccToName: '王小明',
        ccType: 'ACKNOWLEDGE',
        reason: '補充確認'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockIsReviewerFor).toHaveBeenCalledWith(18, 'Operations', 'LEAVE');
    expect(mockPrisma.approvalCC.create).toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON before querying approval records', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 18 } as never);

    const request = new NextRequest('http://localhost/api/approval-cc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.approvalInstance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.approvalCC.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.approvalCC.create).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
