jest.mock('@/lib/database', () => ({
  prisma: {
    compLeaveTransaction: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    compLeaveBalance: {
      create: jest.fn(),
      findUnique: jest.fn(),
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
import { GET, POST } from '../route';

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

  it('rejects malformed admin employeeId query parameters before reading balances', async () => {
    const request = new NextRequest('http://localhost/api/comp-leave/balance?employeeId=9abc', {
      headers: {
        cookie: 'auth-token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'employeeId 參數格式無效' });
    expect(mockPrisma.compLeaveBalance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.compLeaveBalance.create).not.toHaveBeenCalled();
    expect(mockPrisma.compLeaveTransaction.findMany).not.toHaveBeenCalled();
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

describe('comp leave personal balance query', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', userId: 3, employeeId: 10 } as never);
  });

  it('reports confirmed, pending and available hours with the same definition as approval', async () => {
    mockPrisma.compLeaveBalance.findUnique.mockResolvedValue({
      id: 1, employeeId: 10, totalEarned: 8, totalUsed: 0, balance: 8, pendingEarn: 0, pendingUse: 6, updatedAt: new Date(),
    } as never);
    mockPrisma.compLeaveTransaction.findMany.mockResolvedValue([] as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/comp-leave/balance'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.balance).toEqual(expect.objectContaining({
      confirmedBalance: 8,
      pendingBalance: -6,
      availableBalance: 2,
    }));
  });
});

describe('comp leave transaction history paging', () => {
  // 21 筆，其中 6 筆在同一個時間建立（用 createdAt 單獨排序會不穩定）
  const dataset = Array.from({ length: 21 }, (_, index) => ({
    id: index + 1,
    employeeId: 10,
    transactionType: 'EARN',
    hours: 1,
    createdAt: new Date(index >= 15 ? '2026-11-01T00:00:00.000Z' : `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
  })).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', userId: 3, employeeId: 10 } as never);
    mockPrisma.compLeaveBalance.findUnique.mockResolvedValue({
      id: 1, employeeId: 10, totalEarned: 21, totalUsed: 0, balance: 21, pendingEarn: 0, pendingUse: 0, updatedAt: new Date(),
    } as never);
    // 依 cursor／skip／take 切同一份已排序的資料，等同資料庫的行為
    mockPrisma.compLeaveTransaction.findMany.mockImplementation((async (args: { cursor?: { id: number }; skip?: number; take: number }) => {
      const start = args.cursor ? dataset.findIndex((row) => row.id === args.cursor!.id) + (args.skip ?? 0) : 0;
      return dataset.slice(start, start + args.take);
    }) as never);
  });

  const load = async (query = '') => (await GET(new NextRequest(`http://localhost:3000/api/comp-leave/balance${query}`))).json();

  it('returns 20 newest first, tells whether older records exist, and orders by date then id', async () => {
    const page = await load();

    expect(page.recentTransactions).toHaveLength(20);
    expect(page.hasMoreTransactions).toBe(true);
    expect(page.nextCursor).toBe(page.recentTransactions[19].id);
    expect(mockPrisma.compLeaveTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21 })
    );
  });

  it('loads the 21st record on the second page, with no duplicates across the two pages', async () => {
    const first = await load();
    const second = await load(`?cursor=${first.nextCursor}`);

    expect(second.recentTransactions).toHaveLength(1);
    expect(second.hasMoreTransactions).toBe(false);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.recentTransactions, ...second.recentTransactions].map((row: { id: number }) => row.id);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
    expect(mockPrisma.compLeaveTransaction.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: first.nextCursor }, skip: 1 })
    );
  });

  it('rejects a malformed cursor before querying transactions', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/comp-leave/balance?cursor=abc'));

    expect(response.status).toBe(400);
    expect(mockPrisma.compLeaveTransaction.findMany).not.toHaveBeenCalled();
  });
});
