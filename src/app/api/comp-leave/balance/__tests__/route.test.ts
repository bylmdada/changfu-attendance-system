jest.mock('@/lib/database', () => ({
  prisma: {
    compLeaveTransaction: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    compLeaveBalance: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

const transactionClient = {
  compLeaveTransaction: {
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  compLeaveBalance: {
    upsert: jest.fn(),
  },
};

describe('comp leave balance recomputation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.compLeaveTransaction.updateMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
    transactionClient.compLeaveTransaction.updateMany.mockResolvedValue({ count: 0 } as never);
  });

  it('rejects POST when csrf validation fails before freezing transactions', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/comp-leave/balance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        employeeId: 9,
        yearMonth: '2026-04',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.compLeaveTransaction.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.compLeaveBalance.upsert).not.toHaveBeenCalled();
  });

  it('uses only the latest import baseline and applies newer non-import transactions after it', async () => {
    transactionClient.compLeaveTransaction.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 8,
        isFrozen: true,
        referenceType: 'IMPORT',
        yearMonth: '2026-03',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        id: 2,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 3,
        isFrozen: true,
        referenceType: 'OVERTIME',
        yearMonth: '2026-03',
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
      },
      {
        id: 3,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 12,
        isFrozen: true,
        referenceType: 'IMPORT',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      },
      {
        id: 4,
        employeeId: 9,
        transactionType: 'USE',
        hours: 2,
        isFrozen: true,
        referenceType: 'LEAVE',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-03T00:00:00.000Z'),
      },
      {
        id: 5,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 1,
        isFrozen: true,
        referenceType: 'OVERTIME',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-05T00:00:00.000Z'),
      },
    ] as never);
    transactionClient.compLeaveBalance.upsert.mockResolvedValue({
      employeeId: 9,
      totalEarned: 13,
      totalUsed: 2,
      balance: 11,
      pendingEarn: 0,
      pendingUse: 0,
    } as never);

    const request = new NextRequest('http://localhost/api/comp-leave/balance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        employeeId: 9,
        yearMonth: '2026-04',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(transactionClient.compLeaveBalance.upsert).toHaveBeenCalledWith({
      where: { employeeId: 9 },
      update: {
        totalEarned: 13,
        totalUsed: 2,
        balance: 11,
        pendingEarn: 0,
        pendingUse: 0,
      },
      create: {
        employeeId: 9,
        totalEarned: 13,
        totalUsed: 2,
        balance: 11,
        pendingEarn: 0,
        pendingUse: 0,
      },
    });
  });

  it('wraps transaction freezing and balance recomputation in a transaction', async () => {
    transactionClient.compLeaveTransaction.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 8,
        isFrozen: true,
        referenceType: 'OVERTIME',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ] as never);
    transactionClient.compLeaveBalance.upsert.mockResolvedValue({
      employeeId: 9,
      totalEarned: 8,
      totalUsed: 0,
      balance: 8,
      pendingEarn: 0,
      pendingUse: 0,
    } as never);

    const request = new NextRequest('http://localhost/api/comp-leave/balance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        employeeId: 9,
        yearMonth: '2026-04',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.compLeaveTransaction.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.compLeaveBalance.upsert).not.toHaveBeenCalled();
    expect(transactionClient.compLeaveTransaction.updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 9,
        yearMonth: '2026-04',
        isFrozen: false,
      },
      data: { isFrozen: true },
    });
    expect(transactionClient.compLeaveBalance.upsert).toHaveBeenCalled();
  });

  it('rejects malformed POST bodies before freezing transactions', async () => {
    const request = new NextRequest('http://localhost/api/comp-leave/balance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: '{"employeeId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.compLeaveTransaction.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.compLeaveBalance.upsert).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before freezing transactions', async () => {
    const request = new NextRequest('http://localhost/api/comp-leave/balance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的補休餘額更新資料' });
    expect(mockPrisma.compLeaveTransaction.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.compLeaveBalance.upsert).not.toHaveBeenCalled();
  });
});