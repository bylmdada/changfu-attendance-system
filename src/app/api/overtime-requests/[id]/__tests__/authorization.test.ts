import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/overtime-requests/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { isReviewerFor } from '@/lib/approval-service';
import { getApprovalWorkflow } from '@/lib/approval-workflow';
import { calculateOvertimePayForRequest } from '@/lib/salary-utils';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
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

jest.mock('@/lib/email', () => ({
  notifyOvertimeApproval: jest.fn(),
}));

jest.mock('@/lib/salary-utils', () => ({
  calculateOvertimePayForRequest: jest.fn(),
}));

jest.mock('@/lib/overtime-eligibility', () => ({
  calculateOvertimeRequestEligibility: jest.fn().mockResolvedValue({
    hasCompleteAttendance: true,
    effectiveHours: 2,
    overtimeType: 'WEEKDAY',
  }),
  getOvertimeEligibilityError: jest.fn().mockReturnValue(null),
}));

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn(),
  getTaiwanYearMonth: jest.fn(),
}));

jest.mock('@/lib/hr-notification', () => ({
  notifyHRAfterManagerReview: jest.fn(),
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn().mockResolvedValue({ enableCC: false, requireManager: true }),
}));

jest.mock('@/lib/approval-service', () => ({
  isReviewerFor: jest.fn(),
}));

jest.mock('@/lib/overtime-settings', () => ({
  getStoredOvertimeCalculationSettings: jest.fn().mockResolvedValue({ overtimeMinUnit: 30 }),
}));

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn().mockResolvedValue({ isFrozen: false }),
  getAttendanceFreezeError: jest.fn().mockReturnValue(null),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockIsReviewerFor = isReviewerFor as jest.MockedFunction<typeof isReviewerFor>;
const mockGetApprovalWorkflow = getApprovalWorkflow as jest.MockedFunction<typeof getApprovalWorkflow>;
const mockCalculateOvertimePayForRequest = calculateOvertimePayForRequest as jest.MockedFunction<typeof calculateOvertimePayForRequest>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;

describe('overtime request item authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockIsReviewerFor.mockResolvedValue({ isReviewer: false, role: null } as never);
    mockGetApprovalWorkflow.mockResolvedValue({ enableCC: false, requireManager: true } as never);
    mockCalculateOvertimePayForRequest.mockResolvedValue({
      success: true,
      overtimePay: 500,
      hourlyRate: 200,
    } as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING',
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      totalHours: 2,
      compensationType: 'OVERTIME_PAY',
      employee: {
        id: 10,
        name: '王小明',
        department: '製造部',
      },
    } as never);
  });

  it('rejects manager review when the request employee is outside managed departments', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
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
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
  });

  it('allows manager review when the employee department is managed', async () => {
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '李主管' } as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
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
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalled();
  });

  it('passes the persisted Prisma Date directly to the attendance freeze check', async () => {
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '李主管' } as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(200);
    expect(mockCheckAttendanceFreeze).toHaveBeenCalledWith(
      new Date('2026-04-01T00:00:00.000Z')
    );
    const freezeDate = mockCheckAttendanceFreeze.mock.calls[0][0];
    expect(Number.isNaN(freezeDate.getTime())).toBe(false);
  });

  it('finalizes a one-level overtime workflow with the manager as the actual approver', async () => {
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' } as never);
    mockGetApprovalWorkflow.mockResolvedValue({
      approvalLevel: 1,
      enableCC: false,
      requireManager: true,
    } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '黃主任' } as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 5, status: 'APPROVED' } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED', note: '一階決核通過' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 99,
          approvedAt: expect.any(Date),
          managerReviewerId: 99,
          managerOpinion: 'AGREE',
          managerNote: '一階決核通過',
          managerReviewedAt: expect.any(Date),
        }),
      })
    );
  });

  it('allows a department manager to edit a pending request for an employee in the managed department', async () => {
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'MANAGER' } as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({
      id: 5,
      reason: '主管修正原因',
      workContent: '主管修正內容',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '主管修正原因', workContent: '主管修正內容' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockIsReviewerFor).toHaveBeenCalledWith(99, '製造部', 'OVERTIME');
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          reason: '主管修正原因',
          workContent: '主管修正內容',
        }),
      })
    );
  });

  it('does not allow a manager to edit a pending request outside managed departments', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '不應允許的修改' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('權限');
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
  });

  it('allows reviewer delegates to submit manager-stage review with APPROVED status payloads', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'USER',
      employeeId: 77,
      userId: 177,
    } as never);
    mockIsReviewerFor.mockResolvedValue({ isReviewer: true, role: 'DEPUTY' } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '授權審核員' } as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
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
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_ADMIN',
          managerReviewerId: 77,
          managerOpinion: 'AGREE',
        }),
      })
    );
  });

  it('rejects malformed ids on PATCH before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/abc', {
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
    expect(payload.error).toBe('加班申請 ID 格式錯誤');
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
  });

  it('does not allow admin to bypass required manager review', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 188,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
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
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
  });
});
