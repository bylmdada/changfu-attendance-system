import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '@/app/api/resignation-settlement/preview/route';

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
    },
    resignationSettlement: {
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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('resignation settlement preview query guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
  });

  it('returns 400 when employeeId query is not a clean positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation-settlement/preview?employeeId=7abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('員工ID格式無效');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.resignationSettlement.findUnique).not.toHaveBeenCalled();
  });
});