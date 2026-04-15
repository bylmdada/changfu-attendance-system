jest.mock('@/lib/database', () => ({
  prisma: {
    dependentHistoryLog: {
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
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('dependent history route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    mockPrisma.dependentHistoryLog.findMany.mockResolvedValue([] as never);
  });

  it('rejects invalid dependentId query values before reaching prisma', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-history?dependentId=abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('眷屬 ID 格式無效');
    expect(mockPrisma.dependentHistoryLog.findMany).not.toHaveBeenCalled();
  });

  it('caps large limit values to protect history queries', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-history?limit=5000');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.dependentHistoryLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      })
    );
  });
});