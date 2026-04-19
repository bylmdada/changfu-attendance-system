import { NextRequest } from 'next/server';
import { POST } from '@/app/api/overtime-requests/batch-approve/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { calculateOvertimePayForRequest } from '@/lib/salary-utils';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    compLeaveTransaction: {
      create: jest.fn(),
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

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/salary-utils', () => ({
  calculateOvertimePayForRequest: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCalculateOvertimePayForRequest = calculateOvertimePayForRequest as jest.MockedFunction<typeof calculateOvertimePayForRequest>;

const transactionClient = {
  overtimeRequest: {
    update: jest.fn(),
  },
  compLeaveTransaction: {
    create: jest.fn(),
  },
  compLeaveBalance: {
    upsert: jest.fn(),
  },
};

function resetNestedMockFunctions(record: Record<string, unknown>) {
  for (const value of Object.values(record)) {
    if (typeof value === 'function' && 'mockReset' in value) {
      (value as jest.Mock).mockReset();
      continue;
    }

    if (value && typeof value === 'object') {
      resetNestedMockFunctions(value as Record<string, unknown>);
    }
  }
}

describe('overtime batch-approve route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNestedMockFunctions(transactionClient as unknown as Record<string, unknown>);
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 777,
    } as never);
    mockPrisma.overtimeRequest.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
    mockedCalculateOvertimePayForRequest.mockResolvedValue({ success: true, overtimePay: 600, hourlyRate: 200 } as never);
  });

  it('allows HR users to batch approve final overtime decisions', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'HR',
      employeeId: 66,
      userId: 123,
    } as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 8,
        employeeId: 21,
        overtimeDate: new Date('2026-04-01T10:00:00.000Z'),
        totalHours: 1.5,
        compensationType: 'MEAL_ALLOWANCE',
        reason: '例行維運',
        status: 'PENDING_ADMIN',
      },
    ] as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 8 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [8], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 66,
        }),
      })
    );
  });

  it('rejects requests that exceed the batch-approve endpoint rate limit', async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [8], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toBe('Too many requests');
    expect(mockedValidateCSRF).not.toHaveBeenCalled();
  });

  it('rejects malformed ids before calling updateMany', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['2abc'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ids 格式錯誤');
    expect(mockPrisma.overtimeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before calling updateMany', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"ids":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.overtimeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('allows admins to batch approve requests already forwarded to pending admin', async () => {
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 8,
        employeeId: 21,
        overtimeDate: new Date('2026-04-01T10:00:00.000Z'),
        totalHours: 1.5,
        compensationType: 'MEAL_ALLOWANCE',
        reason: '例行維運',
        status: 'PENDING_ADMIN',
      },
    ] as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 8 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [8], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockPrisma.overtimeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [8] },
          status: { in: ['PENDING', 'PENDING_ADMIN'] },
        }),
      })
    );
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
        }),
      })
    );
  });

  it('rejects batch rejection when every selected overtime request has already been processed', async () => {
    mockPrisma.overtimeRequest.updateMany.mockResolvedValue({ count: 0 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [18], action: 'REJECTED', remarks: '資料不完整' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請已被處理' });
  });

  it('does not write a non-existent rejectReason field when batch rejecting overtime requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [18], action: 'REJECTED', remarks: '資料不完整' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);

    const updateManyArgs = mockPrisma.overtimeRequest.updateMany.mock.calls[0][0];
    expect(updateManyArgs.data).toEqual(
      expect.objectContaining({
        status: 'REJECTED',
        approvedBy: 88,
      })
    );
    expect(updateManyArgs.data).not.toHaveProperty('rejectReason');
  });

  it('rejects batch approval when every selected overtime request has already been processed', async () => {
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [19], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請已被處理' });
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('accrues pending comp leave transactionally when approving comp-leave requests', async () => {
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 8,
        employeeId: 31,
        overtimeDate: new Date('2026-03-31T16:30:00.000Z'),
        totalHours: 2,
        compensationType: 'COMP_LEAVE',
        reason: '月底加班',
        status: 'PENDING_ADMIN',
      },
    ] as never);
    transactionClient.overtimeRequest.update.mockResolvedValue({ id: 8 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [8], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
        }),
      })
    );
    expect(transactionClient.compLeaveTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: 31,
          transactionType: 'EARN',
          hours: 2,
          yearMonth: '2026-04',
          isFrozen: false,
        }),
      })
    );
    expect(transactionClient.compLeaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          pendingEarn: { increment: 2 },
        }),
      })
    );
    expect(mockPrisma.overtimeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('calculates overtime pay fields when approving overtime-pay requests', async () => {
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 9,
        employeeId: 32,
        overtimeDate: new Date('2026-04-05T10:00:00.000Z'),
        totalHours: 3,
        compensationType: 'OVERTIME_PAY',
        reason: '假日加班',
        status: 'PENDING',
      },
    ] as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 9 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [9], action: 'APPROVED', overtimeType: 'HOLIDAY' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockedCalculateOvertimePayForRequest).toHaveBeenCalledWith(
      32,
      new Date('2026-04-05T10:00:00.000Z'),
      3,
      'HOLIDAY'
    );
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
          overtimeType: 'HOLIDAY',
          overtimePay: 600,
          hourlyRateUsed: 200,
        }),
      })
    );
    expect(mockPrisma.overtimeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when overtime-pay calculation fails for every selected request', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 10,
        employeeId: 45,
        overtimeDate: new Date('2026-04-06T10:00:00.000Z'),
        totalHours: 2.5,
        compensationType: 'OVERTIME_PAY',
        reason: '假日支援',
        status: 'PENDING_ADMIN',
      },
    ] as never);
    mockedCalculateOvertimePayForRequest.mockResolvedValue({ success: false, error: 'salary missing' } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [10], action: 'APPROVED', overtimeType: 'HOLIDAY' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ID 10: 加班費計算失敗：salary missing');
    expect(payload.failedIds).toEqual([10]);
    expect(payload.errors).toEqual(['ID 10: 加班費計算失敗：salary missing']);
    expect(mockedCalculateOvertimePayForRequest).toHaveBeenCalledWith(
      45,
      new Date('2026-04-06T10:00:00.000Z'),
      2.5,
      'HOLIDAY'
    );
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('批次計算加班費失敗:', 'salary missing');

    consoleErrorSpy.mockRestore();
  });
});
