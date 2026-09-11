import { NextRequest } from 'next/server';
import { POST } from '@/app/api/overtime-requests/batch/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { calculateOvertimePayForRequest } from '@/lib/salary-utils';
import { getTaiwanYearMonth } from '@/lib/timezone';
import {
  calculateOvertimeRequestEligibility,
  getOvertimeEligibilityError,
} from '@/lib/overtime-eligibility';
import { isReviewerFor } from '@/lib/approval-service';
import { getApprovalWorkflow } from '@/lib/approval-workflow';

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

jest.mock('@/lib/overtime-eligibility', () => ({
  calculateOvertimeRequestEligibility: jest.fn(),
  getOvertimeEligibilityError: jest.fn(),
}));

jest.mock('@/lib/approval-service', () => ({
  isReviewerFor: jest.fn(),
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn().mockResolvedValue({ requireManager: true }),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCalculateOvertimePayForRequest = calculateOvertimePayForRequest as jest.MockedFunction<typeof calculateOvertimePayForRequest>;
const mockedGetTaiwanYearMonth = getTaiwanYearMonth as jest.MockedFunction<typeof getTaiwanYearMonth>;
const mockedCalculateOvertimeRequestEligibility = calculateOvertimeRequestEligibility as jest.MockedFunction<typeof calculateOvertimeRequestEligibility>;
const mockedGetOvertimeEligibilityError = getOvertimeEligibilityError as jest.MockedFunction<typeof getOvertimeEligibilityError>;
const mockedIsReviewerFor = isReviewerFor as jest.MockedFunction<typeof isReviewerFor>;
const mockedGetApprovalWorkflow = getApprovalWorkflow as jest.MockedFunction<typeof getApprovalWorkflow>;

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
    mockedCalculateOvertimeRequestEligibility.mockResolvedValue({
      hasCompleteAttendance: true,
      effectiveHours: 1.5,
      overtimeType: 'WEEKDAY',
    } as never);
    mockedGetOvertimeEligibilityError.mockReturnValue(null);
    mockedIsReviewerFor.mockResolvedValue({ isReviewer: false, role: null } as never);
    mockedGetApprovalWorkflow.mockResolvedValue({ approvalLevel: 2, requireManager: true } as never);
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
      1.5,
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

  it('allows a department manager to batch approve pending overtime requests in the managed department', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 77,
      userId: 700,
    } as never);
    mockedIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' } as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      status: 'PENDING',
      compensationType: 'OVERTIME_PAY',
      totalHours: 2,
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      reason: '閉店支援',
      employee: {
        name: '王小明',
        department: '溪北輔具中心',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [1], action: 'APPROVED', notes: '資料正確' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.successCount).toBe(1);
    expect(mockedIsReviewerFor).toHaveBeenCalledWith(77, '溪北輔具中心', 'OVERTIME');
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: 'PENDING_ADMIN',
        managerReviewerId: 77,
        managerOpinion: 'AGREE',
        managerNote: '資料正確',
        managerReviewedAt: expect.any(Date),
      }),
    });
    expect(mockedCalculateOvertimeRequestEligibility).not.toHaveBeenCalled();
    expect(mockedCalculateOvertimePayForRequest).not.toHaveBeenCalled();
  });

  it('finalizes manager batch approval when the department uses a one-level workflow', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 77,
      userId: 700,
    } as never);
    mockedIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' } as never);
    mockedGetApprovalWorkflow.mockResolvedValue({ approvalLevel: 1, requireManager: true } as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      status: 'PENDING',
      compensationType: 'OVERTIME_PAY',
      totalHours: 2,
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      reason: '閉店支援',
      employee: {
        name: '王小明',
        department: '溪北輔具中心',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [1], action: 'APPROVED', notes: '一階決核通過' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.successCount).toBe(1);
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: 'APPROVED',
        approvedBy: 77,
        approvedAt: expect.any(Date),
        managerReviewerId: 77,
        managerOpinion: 'AGREE',
        managerNote: '一階決核通過',
        managerReviewedAt: expect.any(Date),
        overtimePay: 600,
      }),
    });
  });

  it('keeps an out-of-scope request pending when a manager attempts batch approval', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 77,
      userId: 700,
    } as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      status: 'PENDING',
      compensationType: 'OVERTIME_PAY',
      totalHours: 2,
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      reason: '閉店支援',
      employee: {
        name: '王小明',
        department: '其他中心',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [1], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('無權限審核此部門');
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
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
          overtimeType: 'WEEKDAY',
        }),
      })
    );
    expect(transactionClient.compLeaveBalance.upsert).toHaveBeenCalledWith({
      where: { employeeId: 10 },
      update: {
        pendingEarn: { increment: 1.5 },
      },
      create: {
        employeeId: 10,
        pendingEarn: 1.5,
      },
    });
    expect(transactionClient.compLeaveTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 10,
        transactionType: 'EARN',
        hours: 1.5,
        referenceId: 1,
        referenceType: 'OVERTIME',
        yearMonth: '2026-04',
        description: '加班審核通過 - 閉店支援',
        isFrozen: false,
      }),
    });
  });

  it('does not approve a request when actual attendance has no eligible overtime', async () => {
    mockedCalculateOvertimeRequestEligibility.mockResolvedValue({
      hasCompleteAttendance: true,
      effectiveHours: 0,
      overtimeType: 'WEEKDAY',
    } as never);
    mockedGetOvertimeEligibilityError.mockReturnValue('當日實際淨工時未達法定加班門檻，無可核准的加班時數');

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
    expect(payload.error).toBe('ID 1: 當日實際淨工時未達法定加班門檻，無可核准的加班時數');
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedCalculateOvertimePayForRequest).not.toHaveBeenCalled();
  });

  it('returns 400 when overtime-pay calculation fails for every selected request', async () => {
    mockedCalculateOvertimePayForRequest.mockResolvedValue({ success: false, error: 'salary missing' } as never);
    mockedCalculateOvertimeRequestEligibility.mockResolvedValue({
      hasCompleteAttendance: true,
      effectiveHours: 1.5,
      overtimeType: 'HOLIDAY',
    } as never);

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
      1.5,
      'HOLIDAY'
    );
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
