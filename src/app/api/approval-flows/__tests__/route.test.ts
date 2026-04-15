jest.mock('@/lib/database', () => ({
  prisma: {
    approvalFlow: {
      findMany: jest.fn(),
      upsert: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('approval flows route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    mockGetUserFromToken.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    mockPrisma.approvalFlow.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/approval-flows', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockGetUserFromRequest).toHaveBeenCalled();
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    mockPrisma.approvalFlow.upsert.mockResolvedValue({
      id: 1,
      name: '請假流程',
      resourceType: 'LEAVE',
      steps: JSON.stringify([{ level: 1, approverType: 'MANAGER' }]),
      autoApproveRules: null,
      isActive: true
    } as never);

    const request = new NextRequest('http://localhost/api/approval-flows', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        name: '請假流程',
        resourceType: 'LEAVE',
        steps: [{ level: 1, approverType: 'MANAGER' }],
        isActive: true
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockGetUserFromRequest).toHaveBeenCalled();
  });

  it('rejects null POST request bodies before validating approval flow fields', async () => {
    const request = new NextRequest('http://localhost/api/approval-flows', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的審批流程設定資料' });
    expect(mockPrisma.approvalFlow.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed POST JSON bodies before validating approval flow fields', async () => {
    const request = new NextRequest('http://localhost/api/approval-flows', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: '{"name":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.approvalFlow.upsert).not.toHaveBeenCalled();
  });
});