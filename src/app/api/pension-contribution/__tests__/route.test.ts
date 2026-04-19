import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '@/app/api/pension-contribution/route';

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
    },
    pensionContributionApplication: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('pension contribution root route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'user1',
      role: 'EMPLOYEE',
      sessionId: 'session-1',
    } as never);
  });

  it('returns 400 when POST body JSON is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/pension-contribution', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"requestedRate":3',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.pensionContributionApplication.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.pensionContributionApplication.create).not.toHaveBeenCalled();
  });

  it('accepts 0.5 percent increments within the supported range', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 10,
      laborPensionSelfRate: 1,
    } as never);
    mockPrisma.pensionContributionApplication.findFirst.mockResolvedValue(null as never);
    mockPrisma.pensionContributionApplication.create.mockResolvedValue({
      id: 99,
      status: 'PENDING_HR',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/pension-contribution', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requestedRate: 1.5, reason: '退休規劃調整' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(mockPrisma.pensionContributionApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 10,
        currentRate: 1,
        requestedRate: 1.5,
        reason: '退休規劃調整',
      }),
    });
  });

  it('returns the pending-application message when create hits the unique pending constraint', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 10,
      laborPensionSelfRate: 1,
    } as never);
    mockPrisma.pensionContributionApplication.findFirst.mockResolvedValue(null as never);
    mockPrisma.pensionContributionApplication.create.mockRejectedValue({
      code: 'P2002',
      message: 'Unique constraint failed',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/pension-contribution', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requestedRate: 2 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '您有待處理的申請，請等待審核完成後再提出新申請',
    });
  });
});
