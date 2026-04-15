import { NextRequest } from 'next/server';
import { POST } from '@/app/api/leave-requests/batch-approve/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    leaveRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    schedule: {
      updateMany: jest.fn(),
    },
    annualLeave: {
      updateMany: jest.fn(),
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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

const transactionClient = {
  leaveRequest: {
    update: jest.fn(),
  },
  schedule: {
    updateMany: jest.fn(),
  },
  annualLeave: {
    updateMany: jest.fn(),
  },
};

describe('leave batch-approve route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 777,
    } as never);
    mockPrisma.leaveRequest.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects HR users so legacy leave batch approval stays admin-only for final decisions', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'HR',
      employeeId: 66,
      userId: 123,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ids: [52],
        action: 'APPROVED',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '權限不足' });
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before calling updateMany', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch-approve', {
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
    expect(mockPrisma.leaveRequest.updateMany).not.toHaveBeenCalled();
  });

  it('wraps approved annual leave deduction and status update in a transaction', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 41,
      employeeId: 9,
      status: 'PENDING',
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-04-02T00:00:00.000Z'),
      employee: { id: 9 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 41 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ids: [41],
        action: 'APPROVED',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.leaveRequest.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 41 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
        }),
      })
    );
    expect(transactionClient.annualLeave.updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 9,
        year: 2026,
      },
      data: {
        usedDays: { increment: 2 },
        remainingDays: { decrement: 2 },
      },
    });
  });

  it('splits approved annual leave deductions by year for cross-year requests', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 42,
      employeeId: 9,
      status: 'PENDING',
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-12-31T00:00:00.000Z'),
      endDate: new Date('2027-01-02T00:00:00.000Z'),
      employee: { id: 9 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 42 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ids: [42],
        action: 'APPROVED',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(transactionClient.annualLeave.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        employeeId: 9,
        year: 2026,
      },
      data: {
        usedDays: { increment: 1 },
        remainingDays: { decrement: 1 },
      },
    });
    expect(transactionClient.annualLeave.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        employeeId: 9,
        year: 2027,
      },
      data: {
        usedDays: { increment: 2 },
        remainingDays: { decrement: 2 },
      },
    });
  });

  it('allows admins to batch approve requests already forwarded to pending admin', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 52,
      employeeId: 9,
      status: 'PENDING_ADMIN',
      leaveType: 'SICK_LEAVE',
      startDate: new Date('2026-04-03T00:00:00.000Z'),
      endDate: new Date('2026-04-03T00:00:00.000Z'),
      employee: { id: 9 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 52 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ids: [52],
        action: 'APPROVED',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 52 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
        }),
      })
    );
  });

  it('rejects batch approval when every selected leave request has already been processed', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 54,
      employeeId: 9,
      status: 'APPROVED',
      leaveType: 'SICK_LEAVE',
      startDate: new Date('2026-04-05T00:00:00.000Z'),
      endDate: new Date('2026-04-05T00:00:00.000Z'),
      employee: { id: 9 },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ids: [54],
        action: 'APPROVED',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請已被處理' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('updates schedules to FDL for approved non-annual leave requests', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 53,
      employeeId: 9,
      status: 'PENDING',
      leaveType: 'SICK_LEAVE',
      startDate: new Date('2026-04-03T00:00:00.000Z'),
      endDate: new Date('2026-04-04T00:00:00.000Z'),
      employee: { id: 9 },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 53 } as never);
    transactionClient.schedule.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ids: [53],
        action: 'APPROVED',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        employeeId: 9,
        workDate: '2026-04-03',
      },
      data: {
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
      },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        employeeId: 9,
        workDate: '2026-04-04',
      },
      data: {
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
      },
    });
  });
});