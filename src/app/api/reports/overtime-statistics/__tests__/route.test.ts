import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('overtime statistics route auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    });

    mockedGetUserFromToken.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    });

    mockedPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        employeeId: 1,
        overtimeDate: new Date('2026-03-05T00:00:00.000Z'),
        totalHours: 3,
        employee: {
          id: 1,
          employeeId: 'EMP001',
          name: '王小明',
          department: 'HR',
          position: '專員',
        },
      },
    ] as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost/api/reports/overtime-statistics?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.summary.totalRequests).toBe(1);
  });

  it.each([
    ['year=abc&month=3', '無效的年份參數'],
    ['year=2026&month=13', '無效的月份參數'],
    ['year=2026&employeeId=abc', '無效的員工編號參數'],
  ])('returns 400 for invalid query params: %s', async (queryString, expectedError) => {
    const request = new NextRequest(`http://localhost/api/reports/overtime-statistics?${queryString}`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(expectedError);
    expect(mockedPrisma.overtimeRequest.findMany).not.toHaveBeenCalled();
  });
});