jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    },
    overtimeRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
    approvalInstance: {
      findMany: jest.fn(),
    },
    schedule: { findMany: jest.fn() },
    systemSettings: {
      findUnique: jest.fn(),
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  verifyPassword: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn()
}));

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn((date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10))
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn()
}));

jest.mock('@/lib/overtime-eligibility', () => ({
  calculateOvertimeRequestsEligibility: jest.fn().mockResolvedValue({
    byRequestId: new Map(),
    byEmployeeDate: new Map(),
    totalEffectiveHours: 0,
  }),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, verifyPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCreateApprovalForRequest = createApprovalForRequest as jest.MockedFunction<typeof createApprovalForRequest>;

describe('overtime-requests quick auth account status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remainingRequests: 10, resetTime: Date.now() });
    mockGetUserFromRequest.mockResolvedValue(null);
    mockCheckAttendanceFreeze.mockResolvedValue({ isFrozen: false } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockCreateApprovalForRequest.mockResolvedValue(undefined as never);
    mockPrisma.overtimeRequest.findFirst.mockResolvedValue(null as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.employee.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.approvalInstance.findMany.mockResolvedValue([] as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
  });

  it('loads schedules once and matches employee plus Taiwan date, including missing schedules', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      { id: 1, employeeId: 10, overtimeDate: new Date('2026-09-12T16:30:00Z'), createdAt: new Date(), status: 'PENDING' },
      { id: 2, employeeId: 20, overtimeDate: new Date('2026-09-12T16:30:00Z'), createdAt: new Date(), status: 'PENDING' },
      { id: 3, employeeId: 10, overtimeDate: new Date('2026-09-14T00:00:00Z'), createdAt: new Date(), status: 'PENDING' },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { employeeId: 10, workDate: '2026-09-13', shiftType: 'A', startTime: '08:00', endTime: '16:00' },
      { employeeId: 20, workDate: '2026-09-13', shiftType: 'B', startTime: '16:00', endTime: '00:00' },
    ] as never);
    const response = await GET(new NextRequest('http://localhost/api/overtime-requests'));
    expect(response.status).toBe(200);
    const { overtimeRequests } = await response.json();
    expect(overtimeRequests.map((item: { scheduleShiftType: string | null }) => item.scheduleShiftType)).toEqual(['A', 'B', null]);
    expect(mockPrisma.schedule.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      employeeId: { in: [10, 20] }, workDate: { in: ['2026-09-13', '2026-09-14'] },
    } }));
  });

  it('rejects inactive accounts from submitting overtime with username/password auth', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 5,
      username: 'inactive.user',
      isActive: false,
      passwordHash: 'hash',
      employee: { id: 99, name: '停用員工' }
    } as never);

    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workDate: '2025-01-01',
        startTime: '18:00',
        endTime: '20:00',
        reason: '補資料',
        username: 'inactive.user',
        password: 'secret'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('帳號已停用，請聯繫管理員');
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('returns the actual manager reviewer for requests that passed first-stage approval', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 88,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 31,
        employeeId: 10,
        overtimeDate: new Date('2026-08-17T00:00:00.000Z'),
        startTime: '17:00',
        endTime: '19:00',
        totalHours: 2,
        reason: '設備盤點',
        workContent: null,
        compensationType: 'COMP_LEAVE',
        status: 'PENDING_ADMIN',
        managerReviewerId: 7,
        managerOpinion: 'AGREE',
        managerReviewedAt: new Date('2026-08-17T10:00:00.000Z'),
        approvedBy: null,
        approver: null,
        createdAt: new Date('2026-08-17T09:00:00.000Z'),
        employee: {
          id: 10,
          employeeId: 'E010',
          name: '溪北員工',
          department: '溪北輔具中心',
          position: '專員',
        },
      },
    ] as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 7,
        employeeId: 'M007',
        name: '溪北中心主任',
        department: '溪北輔具中心',
        position: '主任',
      },
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/overtime-requests'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.overtimeRequests[0].managerReviewer).toEqual({
      id: 7,
      employeeId: 'M007',
      name: '溪北中心主任',
      department: '溪北輔具中心',
      position: '主任',
    });
    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        position: true,
      },
    });
  });

  it('returns the final reviewer from approval history when legacy approvedBy is missing', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 88,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 32,
        employeeId: 10,
        overtimeDate: new Date('2026-08-16T00:00:00.000Z'),
        startTime: '17:00',
        endTime: '19:00',
        totalHours: 2,
        reason: '設備盤點',
        workContent: null,
        compensationType: 'COMP_LEAVE',
        status: 'APPROVED',
        managerReviewerId: 7,
        managerOpinion: 'AGREE',
        approvedBy: null,
        approver: null,
        createdAt: new Date('2026-08-16T09:00:00.000Z'),
        employee: {
          id: 10,
          employeeId: 'E010',
          name: '溪北員工',
          department: '溪北輔具中心',
          position: '專員',
        },
      },
    ] as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 7,
        employeeId: 'M007',
        name: '溪北中心主任',
        department: '溪北輔具中心',
        position: '主任',
      },
    ] as never);
    mockPrisma.approvalInstance.findMany.mockResolvedValue([
      {
        requestId: 32,
        reviews: [{
          reviewer: {
            id: 8,
            employeeId: 'A008',
            name: '系統管理員',
            department: '行政部',
            position: '管理員',
          },
        }],
      },
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/overtime-requests'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.overtimeRequests[0].historyApprover).toEqual({
      id: 8,
      employeeId: 'A008',
      name: '系統管理員',
      department: '行政部',
      position: '管理員',
    });
  });

  it('requires csrf validation for session-authenticated submissions even when username is present', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 11,
      employeeId: 99,
      role: 'EMPLOYEE',
      username: 'session.user'
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: false } as never);

    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workDate: '2025-01-01',
        startTime: '18:00',
        endTime: '20:00',
        reason: '補資料',
        username: 'session.user',
        password: 'ignored'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF token validation failed');
    expect(mockValidateCSRF).toHaveBeenCalled();
  });

  it('skips csrf validation for successful username/password quick auth submissions', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 6,
      username: 'quick.user',
      isActive: true,
      passwordHash: 'hash',
      employee: { id: 66, name: '快速員工', department: '製造部', position: '技術員' }
    } as never);
    mockVerifyPassword.mockResolvedValue(true as never);
    mockPrisma.overtimeRequest.create.mockResolvedValue({
      id: 123,
      employeeId: 66,
      status: 'PENDING',
      employee: {
        id: 66,
        employeeId: 'E066',
        name: '快速員工',
        department: '製造部',
        position: '技術員'
      }
    } as never);

    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workDate: '2025-01-01',
        startTime: '18:00',
        endTime: '20:00',
        reason: '補資料',
        workContent: '盤點',
        username: 'quick.user',
        password: 'secret'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockValidateCSRF).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring overtime submission payload', async () => {
    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的加班申請資料');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating overtime submission payload fields', async () => {
    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"workDate":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating overtime submission payload fields', async () => {
    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"workDate":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
  });

  it('returns 401 when neither shared session auth nor quick auth can resolve an employee', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workDate: '2025-01-01',
        startTime: '18:00',
        endTime: '20:00',
        reason: '補資料',
        username: 'missing.user',
        password: 'secret'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
  });

  it('falls back to default overtime limits when settings JSON is malformed', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 11,
      employeeId: 99,
      role: 'EMPLOYEE',
      username: 'session.user'
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'overtime_limit_settings',
      value: '{bad-json'
    } as never);
    mockPrisma.overtimeRequest.create.mockResolvedValue({
      id: 124,
      employeeId: 99,
      status: 'PENDING',
      employee: {
        id: 99,
        employeeId: 'E099',
        name: '一般員工',
        department: '製造部',
        position: '技術員'
      }
    } as never);

    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workDate: '2025-01-01',
        startTime: '18:00',
        endTime: '20:00',
        reason: '補資料'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
  });

  it('returns a duplicate-date error when the create hits a unique constraint race', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 11,
      employeeId: 99,
      role: 'EMPLOYEE',
      username: 'session.user'
    } as never);
    mockPrisma.overtimeRequest.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002'
    }) as never);

    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workDate: '2025-01-01',
        startTime: '18:00',
        endTime: '20:00',
        reason: '補資料'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('該日期已有加班申請');
  });

  it('rejects overtime ranges shorter than the configured minimum instead of rounding them up', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 11,
      employeeId: 99,
      role: 'EMPLOYEE',
      username: 'session.user'
    } as never);
    mockPrisma.systemSettings.findUnique.mockImplementation(async (args: { where: { key: string } }) => {
      if (args.where.key === 'overtime_calculation_settings') {
        return { key: args.where.key, value: JSON.stringify({ overtimeMinUnit: 60 }) } as never;
      }

      return null as never;
    });

    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workDate: '2026-07-08',
        startTime: '17:00',
        endTime: '17:59',
        reason: '短時加班'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('加班時數最少1小時');
    expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
  });

  it('stores the full requested minutes after the configured minimum is met', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 11,
      employeeId: 99,
      role: 'EMPLOYEE',
      username: 'session.user'
    } as never);
    mockPrisma.systemSettings.findUnique.mockImplementation(async (args: { where: { key: string } }) => {
      if (args.where.key === 'overtime_calculation_settings') {
        return { key: args.where.key, value: JSON.stringify({ overtimeMinUnit: 60 }) } as never;
      }

      return null as never;
    });
    mockPrisma.overtimeRequest.create.mockResolvedValue({
      id: 125,
      employeeId: 99,
      status: 'PENDING',
      totalHours: 2,
      employee: {
        id: 99,
        employeeId: 'E099',
        name: '一般員工',
        department: '製造部',
        position: '技術員'
      }
    } as never);

    const request = new NextRequest('http://localhost/api/overtime-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workDate: '2026-07-01',
        startTime: '17:00',
        endTime: '19:31',
        reason: '活動支援'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.overtimeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalHours: 2.52
        })
      })
    );
  });
});
