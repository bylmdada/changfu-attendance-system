jest.mock('@/lib/database', () => ({
  prisma: {
    $transaction: jest.fn(),
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { POST } from '@/app/api/comp-leave/adjust/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('comp leave adjust body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      userId: 1,
      employeeId: 1,
    } as never);
  });

  it('rejects malformed POST bodies before starting a transaction', async () => {
    const request = new NextRequest('http://localhost:3000/api/comp-leave/adjust', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: '{"employeeId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before starting a transaction', async () => {
    const request = new NextRequest('http://localhost:3000/api/comp-leave/adjust', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的補休調整資料' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects array POST bodies before starting a transaction', async () => {
    const request = new NextRequest('http://localhost:3000/api/comp-leave/adjust', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: '[]',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的補休調整資料' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('comp leave manual deduction uses the same available hours as approval', () => {
  // 已確認 8 小時、已核准待扣 6 小時 → 可用只剩 2 小時
  const balanceRow = { id: 1, employeeId: 10, totalEarned: 8, totalUsed: 0, balance: 8, pendingEarn: 0, pendingUse: 6 };
  const makeTx = () => ({
    compLeaveBalance: {
      findUnique: jest.fn().mockResolvedValue(balanceRow),
      create: jest.fn(),
      update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, number> }) => ({ ...balanceRow, ...data })),
    },
    compLeaveTransaction: { create: jest.fn() },
  });
  const adjust = (type: 'add' | 'subtract', hours: number) =>
    POST(new NextRequest('http://localhost:3000/api/comp-leave/adjust', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'csrf-token' },
      body: JSON.stringify({ employeeId: 10, type, hours, reason: '更正' }),
    }));

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', userId: 1, employeeId: 1 } as never);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refuses to deduct 4 hours when only 2 are available, without writing anything', async () => {
    const tx = makeTx();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (callback: (t: unknown) => unknown) => callback(tx));

    const response = await adjust('subtract', 4);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('可用餘額');
    expect(payload.error).toContain('目前可用 2 小時');
    expect(tx.compLeaveBalance.update).not.toHaveBeenCalled();
    expect(tx.compLeaveTransaction.create).not.toHaveBeenCalled();
  });

  it('allows deducting exactly the 2 available hours, which leaves 0 available', async () => {
    const tx = makeTx();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (callback: (t: unknown) => unknown) => callback(tx));

    const response = await adjust('subtract', 2);

    expect(response.status).toBe(200);
    expect(tx.compLeaveBalance.update).toHaveBeenCalledWith({
      where: { employeeId: 10 },
      data: { totalEarned: 8, totalUsed: 2, balance: 6 },
    });
    expect(tx.compLeaveTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('adding hours is never blocked by pending use', async () => {
    const tx = makeTx();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (callback: (t: unknown) => unknown) => callback(tx));

    expect((await adjust('add', 4)).status).toBe(200);
  });
});
