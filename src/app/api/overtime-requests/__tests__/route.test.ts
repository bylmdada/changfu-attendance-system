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
  toTaiwanDateStr: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, verifyPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { POST } from '../route';

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
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
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
});
