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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockLoginLogGroupBy = mockPrisma.loginLog.groupBy as jest.Mock;

describe('login logs route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });
});