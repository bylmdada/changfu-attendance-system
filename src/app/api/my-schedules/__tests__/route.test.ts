jest.mock('@/lib/database', () => ({
  prisma: {
    schedule: {
      findMany: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
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
import { GET } from '@/app/api/my-schedules/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('my-schedules route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 1,
      userId: 10,
    } as never);
  });

  it('rejects malformed month query parameters before hitting Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-schedules?year=2025&month=foo', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'month 參數格式無效' });
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
  });
});