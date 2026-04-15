jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn(),
    },
    compLeaveTransaction: {
      findMany: jest.fn(),
    },
    annualLeave: {
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

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('leave expiry comp leave filtering', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'leave_expiry_settings',
      value: JSON.stringify({
        compLeaveExpiryMonths: 1,
        enabled: true,
      }),
    } as never);
    mockPrisma.annualLeave.findMany.mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ignores imported baseline transactions when calculating expiring comp leave', async () => {
    mockPrisma.compLeaveTransaction.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 5,
        transactionType: 'EARN',
        hours: 10,
        isFrozen: true,
        referenceType: 'IMPORT',
        yearMonth: '2026-03',
        createdAt: new Date('2026-03-13T00:00:00.000Z'),
        employee: {
          id: 5,
          employeeId: 'A001',
          name: '匯入員工',
          department: 'HR',
        },
      },
      {
        id: 2,
        employeeId: 6,
        transactionType: 'EARN',
        hours: 4,
        isFrozen: true,
        referenceType: 'OVERTIME',
        yearMonth: '2026-03',
        createdAt: new Date('2026-03-14T00:00:00.000Z'),
        employee: {
          id: 6,
          employeeId: 'A002',
          name: '正常補休員工',
          department: 'IT',
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/leave-expiry/check', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.expiringLeaves).toHaveLength(1);
    expect(payload.expiringLeaves[0]).toEqual(
      expect.objectContaining({
        type: 'COMP_LEAVE',
        hours: 4,
        employee: expect.objectContaining({
          employeeId: 'A002',
        }),
      })
    );
  });

  it('accepts shared request auth from token cookie instead of manual token decoding', async () => {
    mockPrisma.compLeaveTransaction.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/leave-expiry/check', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockGetUserFromRequest).toHaveBeenCalledWith(request);
    expect(mockGetUserFromToken).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on POST before processing expiry actions', async () => {
    const request = new NextRequest('http://localhost/api/leave-expiry/check', {
      method: 'POST',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: '{"action":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
  });

  it('rejects null JSON bodies on POST before processing expiry actions', async () => {
    const request = new NextRequest('http://localhost/api/leave-expiry/check', {
      method: 'POST',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的到期處理資料');
  });
});