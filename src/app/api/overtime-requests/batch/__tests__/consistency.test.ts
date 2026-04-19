import { NextRequest } from 'next/server';
import { POST } from '@/app/api/overtime-requests/batch/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { calculateOvertimePayForRequest } from '@/lib/salary-utils';
import { getTaiwanYearMonth } from '@/lib/timezone';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    compLeaveBalance: {
      upsert: jest.fn(),
    },
    compLeaveTransaction: {
      create: jest.fn(),
    },
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

jest.mock('@/lib/salary-utils', () => ({
  calculateOvertimePayForRequest: jest.fn(),
}));

jest.mock('@/lib/timezone', () => ({
  getTaiwanYearMonth: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCalculateOvertimePayForRequest = calculateOvertimePayForRequest as jest.MockedFunction<typeof calculateOvertimePayForRequest>;
const mockedGetTaiwanYearMonth = getTaiwanYearMonth as jest.MockedFunction<typeof getTaiwanYearMonth>;

const transactionClient = {
  overtimeRequest: {
    update: jest.fn(),
  },
  compLeaveBalance: {
    upsert: jest.fn(),
  },
  compLeaveTransaction: {
    create: jest.fn(),
  },
};

describe('overtime batch approval consistency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 777,
    } as never);
    mockedCalculateOvertimePayForRequest.mockResolvedValue({ success: true, overtimePay: 600, hourlyRate: 200 } as never);
    mockedGetTaiwanYearMonth.mockReturnValue('2026-04' as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      status: 'PENDING_ADMIN',
      compensationType: 'OVERTIME_PAY',
      totalHours: 2,
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      reason: '閉店支援',
      employee: {
        name: '王小明',
      },
    } as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 1 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects malformed ids before touching prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['1abc'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ids 格式錯誤');
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
  });

  it('accepts requests already forwarded to admin and records the employee approver id', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['1'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.successCount).toBe(1);
    expect(mockedCalculateOvertimePayForRequest).toHaveBeenCalledWith(
      10,
      new Date('2026-04-01T00:00:00.000Z'),
      2,
      'WEEKDAY'
    );
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
          overtimeType: 'WEEKDAY',
          overtimePay: 600,
          hourlyRateUsed: 200,
        }),
      })
    );
  });

  it('returns 400 when every selected overtime request has already been processed', async () => {
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      status: 'APPROVED',
      compensationType: 'OVERTIME_PAY',
      totalHours: 2,
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      reason: '閉店支援',
      employee: {
        name: '王小明',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['1'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請已被處理');
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('wraps approved comp-leave accrual in a transaction', async () => {
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      status: 'PENDING_ADMIN',
      compensationType: 'COMP_LEAVE',
      totalHours: 2,
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      reason: '閉店支援',
      employee: {
        name: '王小明',
      },
    } as never);
    transactionClient.overtimeRequest.update.mockResolvedValue({ id: 1 } as never);
    transactionClient.compLeaveBalance.upsert.mockResolvedValue({ id: 1 } as never);
    transactionClient.compLeaveTransaction.create.mockResolvedValue({ id: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['1'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.successCount).toBe(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
        }),
      })
    );
    expect(transactionClient.compLeaveBalance.upsert).toHaveBeenCalledWith({
      where: { employeeId: 10 },
      update: {
        pendingEarn: { increment: 2 },
      },
      create: {
        employeeId: 10,
        pendingEarn: 2,
      },
    });
    expect(transactionClient.compLeaveTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 10,
        transactionType: 'EARN',
        hours: 2,
        referenceId: 1,
        referenceType: 'OVERTIME',
        yearMonth: '2026-04',
        description: '加班審核通過 - 閉店支援',
        isFrozen: false,
      }),
    });
  });

  it('returns 400 when overtime-pay calculation fails for every selected request', async () => {
    mockedCalculateOvertimePayForRequest.mockResolvedValue({ success: false, error: 'salary missing' } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['1'], action: 'APPROVED', overtimeType: 'HOLIDAY' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ID 1: 加班費計算失敗：salary missing');
    expect(payload.failedIds).toEqual([1]);
    expect(payload.errors).toEqual(['ID 1: 加班費計算失敗：salary missing']);
    expect(mockedCalculateOvertimePayForRequest).toHaveBeenCalledWith(
      10,
      new Date('2026-04-01T00:00:00.000Z'),
      2,
      'HOLIDAY'
    );
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
