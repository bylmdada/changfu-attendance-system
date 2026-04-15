import { NextRequest } from 'next/server';
import { GET } from '@/app/api/overtime-status/route';
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
    overtimeClockRecord: {
      findMany: jest.fn(),
    },
    overtimeRequest: {
      findMany: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
  },
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('overtime status auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockedGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/overtime-status');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('未授權訪問');
  });
});