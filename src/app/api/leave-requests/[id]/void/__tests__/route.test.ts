import { NextRequest } from 'next/server';
import { POST } from '@/app/api/leave-requests/[id]/void/route';
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

describe('leave request void guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects malformed ids before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/abc/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'admin void' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請假申請 ID 格式錯誤');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/void', {
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
    expect(payload.error).toBe('請提供有效的請假作廢資料');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed POST bodies before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/void', {
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

  it('wraps annual leave refund when voiding an approved leave request', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 8,
      employeeId: 10,
      status: 'APPROVED',
      leaveType: 'ANNUAL',
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: new Date('2026-05-03T00:00:00.000Z'),
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 8 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/8/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '資料誤建，作廢' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: '8' }) });
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
          status: 'VOIDED',
          voidedBy: 1,
        }),
      })
    );
    expect(transactionClient.annualLeave.updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 10,
        year: 2026,
      },
      data: {
        usedDays: { decrement: 3 },
        remainingDays: { increment: 3 },
      },
    });
  });

  it('refunds cross-year annual leave back into each yearly balance when voiding', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 9,
      employeeId: 10,
      status: 'APPROVED',
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-12-31T00:00:00.000Z'),
      endDate: new Date('2027-01-02T00:00:00.000Z'),
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 9 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/9/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '跨年請假作廢' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: '9' }) });
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
