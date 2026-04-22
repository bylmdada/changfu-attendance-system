import { NextRequest } from 'next/server';

import { POST } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, verifyPassword } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkClockRateLimit, clearFailedAttempts, recordFailedClockAttempt } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    attendanceRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkClockRateLimit: jest.fn(),
  clearFailedAttempts: jest.fn(),
  recordFailedClockAttempt: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckClockRateLimit = checkClockRateLimit as jest.MockedFunction<typeof checkClockRateLimit>;
const mockClearFailedAttempts = clearFailedAttempts as jest.MockedFunction<typeof clearFailedAttempts>;
const mockRecordFailedClockAttempt = recordFailedClockAttempt as jest.MockedFunction<typeof recordFailedClockAttempt>;

describe('attendance update-reason route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockCheckClockRateLimit.mockResolvedValue({ allowed: true });
    mockRecordFailedClockAttempt.mockResolvedValue(undefined);
    mockClearFailedAttempts.mockResolvedValue(undefined);
  });

  it('rejects POST when csrf validation fails before reading attendance records', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false });
    mockGetUserFromRequest.mockResolvedValue({
      userId: 12,
      employeeId: 34,
      username: 'staff',
      role: 'EMPLOYEE',
    });

    const request = new NextRequest('http://localhost/api/attendance/update-reason', {
      method: 'POST',
      body: JSON.stringify({
        attendanceId: 99,
        lateClockOutReason: 'PERSONAL',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.attendanceRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('returns 429 before password verification when quick-auth attempts are rate limited', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockCheckClockRateLimit.mockResolvedValue({
      allowed: false,
      reason: '帳號已被暫時鎖定，請稍後再試',
      retryAfter: 45,
    });

    mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 99,
      employeeId: 34,
      employee: { id: 34, name: 'Test User' },
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/update-reason', {
      method: 'POST',
      body: JSON.stringify({
        attendanceId: 99,
        lateClockOutReason: 'PERSONAL',
        username: 'staff',
        password: 'wrong',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(payload.error).toContain('暫時鎖定');
    expect(mockCheckClockRateLimit).toHaveBeenCalledWith(expect.any(NextRequest), 'staff');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring update-reason credentials', async () => {
    const request = new NextRequest('http://localhost/api/attendance/update-reason', {
      method: 'POST',
      body: 'null',
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('缺少考勤記錄ID');
    expect(mockPrisma.attendanceRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(mockCheckClockRateLimit).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before destructuring update-reason credentials', async () => {
    const request = new NextRequest('http://localhost/api/attendance/update-reason', {
      method: 'POST',
      body: '{"attendanceId":',
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.attendanceRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(mockCheckClockRateLimit).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('rejects inactive quick-auth accounts and records a failed attempt', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);
    mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 99,
      employeeId: 34,
      employee: { id: 34, name: 'Test User' },
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 12,
      username: 'staff',
      isActive: false,
      passwordHash: 'hash',
      employee: { id: 34 },
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/update-reason', {
      method: 'POST',
      body: JSON.stringify({
        attendanceId: 99,
        lateClockOutReason: 'PERSONAL',
        username: 'staff',
        password: 'correct-password',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toContain('帳號已停用');
    expect(mockRecordFailedClockAttempt).toHaveBeenCalledWith('staff');
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
  });

  it('clears failed attempts after successful quick-auth ownership verification', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);
    mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 99,
      employeeId: 34,
      employee: { id: 34, name: 'Test User' },
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 12,
      username: 'staff',
      isActive: true,
      passwordHash: 'hash',
      employee: { id: 34 },
    } as never);
    mockVerifyPassword.mockResolvedValue(true);
    mockPrisma.attendanceRecord.update.mockResolvedValue({
      id: 99,
      employeeId: 34,
      clockOutReason: 'code review、修正、收尾',
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/update-reason', {
      method: 'POST',
      body: JSON.stringify({
        attendanceId: 99,
        clockOutReason: 'WORK',
        username: 'staff',
        password: 'correct-password',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockClearFailedAttempts).toHaveBeenCalledWith('staff');
    expect(mockRecordFailedClockAttempt).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { clockOutReason: 'code review、修正、收尾' },
    });
  });
});
