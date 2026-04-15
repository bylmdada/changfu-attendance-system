import { NextRequest } from 'next/server';
import { POST } from '@/app/api/leave-requests/batch/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    leaveRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    annualLeave: {
      updateMany: jest.fn(),
    },
    schedule: {
      updateMany: jest.fn(),
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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

const transactionClient = {
  leaveRequest: {
    update: jest.fn(),
  },
  annualLeave: {
    updateMany: jest.fn(),
  },
  schedule: {
    updateMany: jest.fn(),
  },
};

describe('leave request batch route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 77,
      userId: 777,
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects POST requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['1'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('records batch approver using employeeId', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      leaveType: 'SICK_LEAVE',
      status: 'PENDING',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-04-01T00:00:00.000Z'),
      employee: { id: 10 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['1'], action: 'APPROVED' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvedBy: 77,
        }),
      })
    );
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('allows admins to batch approve leave requests already forwarded to pending admin', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 2,
      employeeId: 10,
      leaveType: 'SICK_LEAVE',
      status: 'PENDING_ADMIN',
      startDate: new Date('2026-04-03T00:00:00.000Z'),
      endDate: new Date('2026-04-03T00:00:00.000Z'),
      employee: { id: 10 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 2 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['2'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.successCount).toBe(1);
    expect(payload.failedCount).toBe(0);
    expect(payload.errors).toEqual([]);
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 2 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 77,
        }),
      })
    );
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('returns 400 when every selected leave request has already been processed', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      leaveType: 'SICK_LEAVE',
      status: 'APPROVED',
      startDate: new Date('2026-04-05T00:00:00.000Z'),
      endDate: new Date('2026-04-05T00:00:00.000Z'),
      employee: { id: 10 },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['5'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請已被處理');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns failedIds and errors when every selected leave request fails for a non-status reason', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['6'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ID 6: 申請不存在');
    expect(payload.failedIds).toEqual([6]);
    expect(payload.errors).toEqual(['ID 6: 申請不存在']);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists rejectReason for batch rejections sent from the shared batch toolbar payload', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 4,
      employeeId: 10,
      leaveType: 'SICK_LEAVE',
      status: 'PENDING',
      startDate: new Date('2026-04-04T00:00:00.000Z'),
      endDate: new Date('2026-04-04T00:00:00.000Z'),
      employee: { id: 10 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 4 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['4'], action: 'REJECTED', reason: '資料不完整' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.successCount).toBe(1);
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 4 },
        data: expect.objectContaining({
          status: 'REJECTED',
          approvedBy: 77,
          rejectReason: '資料不完整',
        }),
      })
    );
  });

  it('wraps annual leave deduction and status update in a transaction for approved annual leave requests', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      leaveType: 'ANNUAL_LEAVE',
      status: 'PENDING',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-04-02T00:00:00.000Z'),
      employee: { id: 10 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 1 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
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
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledTimes(1);
    expect(transactionClient.annualLeave.updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 10,
        year: 2026,
      },
      data: {
        usedDays: { increment: 2 },
        remainingDays: { decrement: 2 },
      },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        employeeId: 10,
        workDate: '2026-04-01',
      },
      data: {
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
      },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        employeeId: 10,
        workDate: '2026-04-02',
      },
      data: {
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
      },
    });
  });

  it('splits annual leave deductions by year in batch leave approvals that cross New Year', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 3,
      employeeId: 10,
      leaveType: 'ANNUAL_LEAVE',
      status: 'PENDING',
      startDate: new Date('2026-12-31T00:00:00.000Z'),
      endDate: new Date('2027-01-02T00:00:00.000Z'),
      employee: { id: 10 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 3 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);
    transactionClient.schedule.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['3'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.successCount).toBe(1);
    expect(transactionClient.annualLeave.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        employeeId: 10,
        year: 2026,
      },
      data: {
        usedDays: { increment: 1 },
        remainingDays: { decrement: 1 },
      },
    });
    expect(transactionClient.annualLeave.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        employeeId: 10,
        year: 2027,
      },
      data: {
        usedDays: { increment: 2 },
        remainingDays: { decrement: 2 },
      },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        employeeId: 10,
        workDate: '2026-12-31',
      },
      data: {
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
      },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        employeeId: 10,
        workDate: '2027-01-01',
      },
      data: {
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
      },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        employeeId: 10,
        workDate: '2027-01-02',
      },
      data: {
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
      },
    });
  });

  it('rejects null POST bodies before processing batch payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的批次審核資料');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before processing batch payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
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
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed ids in batch payload before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['abc'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的申請 ID 清單');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });
});