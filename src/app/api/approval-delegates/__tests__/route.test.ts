jest.mock('@/lib/database', () => ({
  prisma: {
    approvalDelegate: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    },
    employee: {
      findUnique: jest.fn()
    },
    departmentManager: {
      findFirst: jest.fn()
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
import { DELETE, GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('approval delegates route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    mockGetUserFromToken.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 1 } as never);
    mockPrisma.departmentManager.findFirst.mockResolvedValue({ id: 1 } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    mockPrisma.approvalDelegate.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/approval-delegates', {
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

  it('requires csrf validation on DELETE requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost/api/approval-delegates?id=12', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token'
      }
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF驗證失敗');
    expect(mockPrisma.approvalDelegate.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.approvalDelegate.update).not.toHaveBeenCalled();
  });

  it('rejects malformed delegatorId filters on GET requests', async () => {
    const request = new NextRequest('http://localhost/api/approval-delegates?delegatorId=12abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'delegatorId 格式錯誤' });
    expect(mockPrisma.approvalDelegate.findMany).not.toHaveBeenCalled();
  });

  it('rejects null POST request bodies before validating delegate fields', async () => {
    const request = new NextRequest('http://localhost/api/approval-delegates', {
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
    expect(payload).toEqual({ error: '請提供有效的代理審核設定資料' });
    expect(mockPrisma.approvalDelegate.create).not.toHaveBeenCalled();
  });

  it('rejects malformed POST JSON bodies before validating delegate fields', async () => {
    const request = new NextRequest('http://localhost/api/approval-delegates', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: '{"delegatorId":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.approvalDelegate.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported resourceTypes in POST payloads', async () => {
    const request = new NextRequest('http://localhost/api/approval-delegates', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        delegatorId: 1,
        delegateId: 2,
        startDate: '2026-04-10',
        endDate: '2026-04-12',
        resourceTypes: ['LEAVE', 'PURCHASE']
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'resourceTypes 包含不支援的審核類型' });
    expect(mockPrisma.approvalDelegate.create).not.toHaveBeenCalled();
  });

  it('rejects delegate setup when the delegator is not an active manager', async () => {
    mockPrisma.departmentManager.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/approval-delegates', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        delegatorId: 1,
        delegateId: 2,
        startDate: '2026-04-10',
        endDate: '2026-04-12',
        resourceTypes: ['LEAVE']
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '委託人目前不是有效主管，無法設定代理審核' });
    expect(mockPrisma.approvalDelegate.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.approvalDelegate.create).not.toHaveBeenCalled();
  });
});
