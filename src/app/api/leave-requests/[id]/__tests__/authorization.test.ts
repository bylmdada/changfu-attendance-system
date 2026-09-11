import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/leave-requests/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { isReviewerFor } from '@/lib/approval-service';
import { getApprovalWorkflow } from '@/lib/approval-workflow';

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
      findMany: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
    approvalInstance: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    approvalReview: {
      findFirst: jest.fn(),
      create: jest.fn(),
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

jest.mock('@/lib/schedule-confirm-service', () => ({
  invalidateConfirmation: jest.fn().mockResolvedValue({ invalidated: true }),
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn().mockResolvedValue({ enableCC: false, requireManager: true }),
}));

jest.mock('@/lib/approval-service', () => ({
  isReviewerFor: jest.fn(),
}));

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn().mockResolvedValue({ isFrozen: false }),
  getAttendanceFreezeError: jest.fn().mockReturnValue(null),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockIsReviewerFor = isReviewerFor as jest.MockedFunction<typeof isReviewerFor>;
const mockGetApprovalWorkflow = getApprovalWorkflow as jest.MockedFunction<typeof getApprovalWorkflow>;

const transactionClient = {
  leaveRequest: {
    update: jest.fn(),
  },
  annualLeave: {
    updateMany: jest.fn(),
  },
  schedule: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  approvalInstance: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  approvalReview: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};


function accountingSchedules(args: { where: { workDate: { gte: string; lte: string } } }) {
  const rows = [];
  for (const day = new Date(args.where.workDate.gte); day <= new Date(args.where.workDate.lte); day.setUTCDate(day.getUTCDate() + 1)) {
    rows.push({workDate: day.toISOString().slice(0,10), startTime:'09:00', endTime:'17:00', workHours:8, breakTime:0});
  }
  return Promise.resolve(rows);
}

describe('leave request item authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transactionClient.schedule.findMany.mockImplementation(accountingSchedules);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 });
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockIsReviewerFor.mockResolvedValue({ isReviewer: false, role: null } as never);
    mockGetApprovalWorkflow.mockResolvedValue({ enableCC: false, requireManager: true } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING',
      leaveType: 'ANNUAL',
      startDate: new Date('2026-04-01T01:00:00.000Z'),
      endDate: new Date('2026-04-01T09:00:00.000Z'),
      employee: {
        id: 10,
        name: '王小明',
        department: '製造部',
      },
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue(null as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    transactionClient.approvalInstance.findFirst.mockResolvedValue(null as never);
  });

  it('rejects manager review when the request employee is outside managed departments', async () => {
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
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' } as never);
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

  it('finalizes a one-level department workflow at manager approval', async () => {
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' } as never);
    mockGetApprovalWorkflow.mockResolvedValue({
      approvalLevel: 1,
      requireManager: true,
      enableCC: false,
    } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '溪北主管' } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING',
      leaveType: 'SICK',
      startDate: new Date('2026-08-18T08:00:00.000Z'),
      endDate: new Date('2026-08-18T09:00:00.000Z'),
      employee: {
        id: 10,
        employeeId: 'E010',
        name: '溪北員工',
        department: '溪北輔具中心',
        position: '專員',
      },
    } as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue({
      id: 50,
      currentLevel: 1,
      maxLevel: 1,
      status: 'LEVEL1_REVIEWING',
    } as never);
    transactionClient.approvalInstance.findFirst.mockResolvedValue({
      id: 50,
      currentLevel: 1,
      maxLevel: 1,
      status: 'LEVEL1_REVIEWING',
    });
    transactionClient.leaveRequest.update.mockResolvedValue({
      id: 5,
      status: 'APPROVED',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: '溪北員工',
        department: '溪北輔具中心',
        position: '專員',
      },
    } as never);

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
    expect(payload.message).toBe('請假申請已批准');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 5 }),
        data: expect.objectContaining({
          status: 'APPROVED',
          managerReviewerId: 99,
          managerOpinion: 'AGREE',
          approvedBy: 99,
        }),
      })
    );
    expect(transactionClient.approvalInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'APPROVED', currentLevel: 1 },
      })
    );
  });

  it('allows reviewer delegates to submit manager-stage review with APPROVED status payloads', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'USER',
      employeeId: 77,
      userId: 177,
    } as never);
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'DEPUTY' } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '授權審核員' } as never);
    mockPrisma.leaveRequest.update.mockResolvedValue({ id: 5 } as never);

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
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_ADMIN',
          managerReviewerId: 77,
          managerOpinion: 'AGREE',
        }),
      })
    );
  });

  it('wraps admin approval annual leave deduction and status update in a transaction', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 188,
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING_ADMIN',
      leaveType: 'ANNUAL',
      startDate: new Date('2026-04-01T01:00:00.000Z'),
      endDate: new Date('2026-04-01T09:00:00.000Z'),
      employee: {
        id: 10,
        name: '王小明',
        department: '製造部',
      },
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
        where: expect.objectContaining({ id: 5 }),
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
        remainingDays: { gte: 1 },
      },
      data: {
        usedDays: { increment: 1 },
        remainingDays: { decrement: 1 },
      },
    });
  });

  it('does not allow admin to bypass required manager review', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 188,
    } as never);

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

    expect(response.status).toBe(409);
    expect(payload.error).toContain('部門主管');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
      startDate: new Date('2026-12-31T01:00:00.000Z'),
      endDate: new Date('2027-01-02T09:00:00.000Z'),
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
        remainingDays: { gte: 1 },
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
        remainingDays: { gte: 2 },
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
