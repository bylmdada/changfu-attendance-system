import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { GET, POST } from '@/app/api/resignation/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    resignationRecord: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('resignation route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.resignationRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.resignationRecord.findFirst.mockResolvedValue(null as never);
  });

  it('returns 400 when year query is not a strict integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation?year=2026abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('年份格式無效');
    expect(mockPrisma.resignationRecord.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 when POST body JSON is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"expectedDate":"2026-04-30"',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.resignationRecord.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.resignationRecord.create).not.toHaveBeenCalled();
  });

  it('returns 400 when expectedDate is not a valid ISO date', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        expectedDate: '2026-99-99',
        reason: 'career move',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('預計離職日格式無效');
    expect(mockPrisma.resignationRecord.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.resignationRecord.create).not.toHaveBeenCalled();
  });
});