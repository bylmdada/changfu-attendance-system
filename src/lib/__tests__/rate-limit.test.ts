jest.mock('@/lib/database', () => ({
  prisma: {
    rateLimitRecord: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';

const mockPrisma = prisma as unknown as {
  rateLimitRecord: {
    deleteMany: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
  };
};

describe('checkRateLimit', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-09T00:00:00.000Z'));
    jest.clearAllMocks();
    mockPrisma.rateLimitRecord.deleteMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses endpoint-specific limits for login requests', async () => {
    mockPrisma.rateLimitRecord.findUnique.mockResolvedValue(null);
    mockPrisma.rateLimitRecord.upsert.mockResolvedValue(undefined);

    const request = new NextRequest('http://localhost/api/auth/login', {
      headers: {
        'x-forwarded-for': '203.0.113.10',
      },
    });

    const result = await checkRateLimit(request, '/api/auth/login');

    expect(result.allowed).toBe(true);
    expect(result.remainingRequests).toBe(4);
    expect(result.resetTime).toBe(new Date('2026-04-09T00:15:00.000Z').getTime());
    expect(mockPrisma.rateLimitRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          count: 1,
          key: '203.0.113.10:/api/auth/login',
          resetTime: new Date('2026-04-09T00:15:00.000Z'),
        }),
      })
    );
  });

  it('blocks requests once endpoint-specific limit is exceeded', async () => {
    const futureReset = new Date('2026-04-09T00:15:00.000Z');
    mockPrisma.rateLimitRecord.findUnique.mockResolvedValue({
      key: '203.0.113.10:/api/auth/login',
      count: 5,
      resetTime: futureReset,
    });
    mockPrisma.rateLimitRecord.update.mockResolvedValue({
      count: 6,
    });

    const request = new NextRequest('http://localhost/api/auth/login', {
      headers: {
        'x-forwarded-for': '203.0.113.10',
      },
    });

    const result = await checkRateLimit(request, '/api/auth/login');

    expect(result).toMatchObject({
      allowed: false,
      remainingRequests: 0,
      resetTime: futureReset.getTime(),
      retryAfter: 900,
    });
  });
});