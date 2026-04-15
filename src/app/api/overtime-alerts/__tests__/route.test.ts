import { NextRequest } from 'next/server';
import { GET } from '@/app/api/overtime-alerts/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn(),
    },
    overtimeRequest: {
      findMany: jest.fn(),
    },
  },
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('overtime alerts auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
  });

  it('returns 403 for non-admin roles resolved via shared request auth', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 70,
      role: 'EMPLOYEE',
      username: 'employee',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-alerts');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('需要管理員權限');
  });
});