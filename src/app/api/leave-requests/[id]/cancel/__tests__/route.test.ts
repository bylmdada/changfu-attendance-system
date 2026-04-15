import { NextRequest } from 'next/server';
import { POST, PUT } from '@/app/api/leave-requests/[id]/cancel/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
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
    departmentManager: {
      findMany: jest.fn(),
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
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

const transactionClient = {
  leaveRequest: {
    update: jest.fn(),
  },
  annualLeave: {
    updateMany: jest.fn(),
  },
};

describe('leave request cancellation authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 8,
      employeeId: 10,
      cancellationStatus: 'PENDING_MANAGER',
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-04-10T00:00:00.000Z'),
      endDate: new Date('2026-04-10T00:00:00.000Z'),
      employee: {
        id: 10,
        department: '製造部',
      },
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects manager cancellation review outside managed departments', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '業務部' },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE', note: 'ok' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '8' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('權限');
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on POST before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/abc/cancel', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '我要撤銷' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請假申請 ID 格式錯誤');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/cancel', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '8' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的請假撤銷資料');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed POST bodies before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/cancel', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"reason":',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '8' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on PUT before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/abc/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE', note: 'ok' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請假申請 ID 格式錯誤');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('rejects null PUT bodies before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '8' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的請假撤銷資料');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed PUT bodies before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"opinion":',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '8' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('wraps admin cancellation approval and annual leave refund in a transaction', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 188,
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 8,
      employeeId: 10,
      status: 'APPROVED',
      cancellationStatus: 'PENDING_ADMIN',
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-04-10T00:00:00.000Z'),
      endDate: new Date('2026-04-11T00:00:00.000Z'),
      employee: {
        id: 10,
        department: '製造部',
      },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 8 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'APPROVE', note: '核准撤銷' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '8' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8 },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationStatus: 'APPROVED',
          cancellationAdminApproverId: 88,
        }),
      })
    );
    expect(transactionClient.annualLeave.updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 10,
        year: 2026,
      },
      data: {
        usedDays: { decrement: 2 },
        remainingDays: { increment: 2 },
      },
    });
  });

  it('refunds cross-year annual leave cancellations back into each yearly balance bucket', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 188,
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 9,
      employeeId: 10,
      status: 'APPROVED',
      cancellationStatus: 'PENDING_ADMIN',
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-12-31T00:00:00.000Z'),
      endDate: new Date('2027-01-02T00:00:00.000Z'),
      employee: {
        id: 10,
        department: '製造部',
      },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 9 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/9/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'APPROVE', note: '核准跨年撤銷' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '9' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(transactionClient.annualLeave.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        employeeId: 10,
        year: 2026,
      },
      data: {
        usedDays: { decrement: 1 },
        remainingDays: { increment: 1 },
      },
    });
    expect(transactionClient.annualLeave.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        employeeId: 10,
        year: 2027,
      },
      data: {
        usedDays: { decrement: 2 },
        remainingDays: { increment: 2 },
      },
    });
  });
});