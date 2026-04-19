jest.mock('@/lib/database', () => ({
  prisma: {
    loginLog: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockLoginLogGroupBy = mockPrisma.loginLog.groupBy as jest.Mock;

describe('login logs route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remainingRequests: 59,
      resetTime: Date.now() + 60_000,
    } as never);
  });

  it('rejects unauthenticated requests before querying login logs', async () => {
    mockGetUserFromRequest.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/login-logs?page=1&limit=20');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
    expect(mockPrisma.loginLog.count).not.toHaveBeenCalled();
    expect(mockPrisma.loginLog.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.loginLog.groupBy).not.toHaveBeenCalled();
  });

  it('rejects malformed page values instead of coercing them with parseInt', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/login-logs?page=1abc&limit=20', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('page 參數格式無效');
    expect(mockPrisma.loginLog.count).not.toHaveBeenCalled();
    expect(mockPrisma.loginLog.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.loginLog.groupBy).not.toHaveBeenCalled();
  });

  it('rejects invalid date filters before querying login logs', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/login-logs?startDate=not-a-date', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('日期格式無效');
    expect(mockPrisma.loginLog.count).not.toHaveBeenCalled();
    expect(mockPrisma.loginLog.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.loginLog.groupBy).not.toHaveBeenCalled();
  });

  it('rejects reversed Taiwan date ranges before querying login logs', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/login-logs?startDate=2026-04-19&endDate=2026-04-18');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('開始日期不得晚於結束日期');
    expect(mockPrisma.loginLog.count).not.toHaveBeenCalled();
  });

  it('returns 429 when the login log endpoint exceeds its rate limit', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remainingRequests: 0,
      resetTime: Date.now() + 60_000,
      retryAfter: 30,
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/system-settings/login-logs'));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({ error: '操作過於頻繁', retryAfter: 30 });
    expect(mockGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('allows admins to fetch login logs', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockPrisma.loginLog.count.mockResolvedValue(1);
    mockPrisma.loginLog.findMany.mockResolvedValue([
      {
        id: 10,
        username: 'demo',
        ipAddress: '127.0.0.1',
        device: 'Mac',
        browser: 'Chrome',
        os: 'macOS',
        status: 'SUCCESS',
        failReason: null,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        user: {
          employee: {
            name: '示範員工',
            department: 'HR',
          },
        },
      },
    ] as never);
    mockLoginLogGroupBy.mockResolvedValue([
      {
        status: 'SUCCESS',
        _count: {
          status: 1,
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/system-settings/login-logs?page=1&limit=20', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.logs).toHaveLength(1);
    expect(payload.logs[0]).toMatchObject({
      username: 'demo',
      employeeName: '示範員工',
      department: 'HR',
      status: 'SUCCESS',
    });
    expect(mockPrisma.loginLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    }));
  });

  it('uses Taiwan-time date boundaries when querying login logs', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockPrisma.loginLog.count.mockResolvedValue(0);
    mockPrisma.loginLog.findMany.mockResolvedValue([] as never);
    mockLoginLogGroupBy.mockResolvedValue([] as never);

    const response = await GET(new NextRequest('http://localhost/api/system-settings/login-logs?startDate=2026-04-19&endDate=2026-04-19'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.loginLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        createdAt: {
          gte: new Date('2026-04-18T16:00:00.000Z'),
          lte: new Date('2026-04-19T15:59:59.999Z'),
        },
      }),
    }));
  });
});
