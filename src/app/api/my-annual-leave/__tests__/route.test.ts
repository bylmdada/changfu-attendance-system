jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    annualLeave: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { GET } from '@/app/api/my-annual-leave/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('my annual leave route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 1,
    } as never);
  });

  it('rejects malformed admin employeeId query parameters before hitting Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-annual-leave?employeeId=10abc', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'employeeId 參數格式無效' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });
});