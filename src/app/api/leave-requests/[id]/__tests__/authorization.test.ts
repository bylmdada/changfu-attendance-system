import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/leave-requests/[id]/route';
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
    employee: {
      findUnique: jest.fn(),
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

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/email', () => ({
  notifyLeaveApproval: jest.fn(),
}));

jest.mock('@/lib/hr-notification', () => ({
  notifyHRAfterManagerReview: jest.fn(),
}));

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn(),
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn().mockResolvedValue({ enableCC: false }),
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
};

describe('leave request item authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING',
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-04-01T00:00:00.000Z'),
      employee: {
        id: 10,
        name: '王小明',
        department: '製造部',
      },
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects manager review when the request employee is outside managed departments', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '人資部' },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('權限');
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('allows manager review when the employee department is managed', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '製造部' },
    ] as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '李主管' } as never);
    mockPrisma.leaveRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalled();
  });

  it('wraps admin approval annual leave deduction and status update in a transaction', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 188,
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({
      id: 5,
      status: 'APPROVED',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: '王小明',
        department: '製造部',
        position: '作業員',
      },
    } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
        }),
      })
    );
    expect(transactionClient.annualLeave.updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 10,
        year: 2026,
      },
      data: {
        usedDays: { increment: 1 },
        remainingDays: { decrement: 1 },
      },
    });
  });

  it('splits admin annual leave deductions by year when the approved request crosses New Year', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 188,
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 6,
      employeeId: 10,
      status: 'PENDING_ADMIN',
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-12-31T00:00:00.000Z'),
      endDate: new Date('2027-01-02T00:00:00.000Z'),
      employee: {
        id: 10,
        employeeId: 'E010',
        name: '王小明',
        department: '製造部',
        position: '作業員',
      },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({
      id: 6,
      status: 'APPROVED',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: '王小明',
        department: '製造部',
        position: '作業員',
      },
    } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/6', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '6' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
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
  });

  it('rejects malformed ids on PATCH before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/abc', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請假申請 ID 格式錯誤');
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });
});