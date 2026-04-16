jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    },
    attendanceRecord: {
      findFirst: jest.fn(),
      findMany: jest.fn()
    },
    schedule: {
      findFirst: jest.fn(),
      findMany: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  verifyPassword: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkClockRateLimit: jest.fn(),
  recordFailedClockAttempt: jest.fn(),
  clearFailedAttempts: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyPassword } from '@/lib/auth';
import { checkClockRateLimit, clearFailedAttempts, recordFailedClockAttempt } from '@/lib/rate-limit';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockCheckClockRateLimit = checkClockRateLimit as jest.MockedFunction<typeof checkClockRateLimit>;
const mockRecordFailedClockAttempt = recordFailedClockAttempt as jest.MockedFunction<typeof recordFailedClockAttempt>;
const mockClearFailedAttempts = clearFailedAttempts as jest.MockedFunction<typeof clearFailedAttempts>;

describe('attendance check-today auth guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckClockRateLimit.mockResolvedValue({ allowed: true });
  });

  it('rejects requests without password so attendance data is not anonymously exposed', async () => {
    const request = new NextRequest('http://localhost/api/attendance/check-today', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供帳號和密碼');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring quick-auth credentials', async () => {
    const request = new NextRequest('http://localhost/api/attendance/check-today', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供帳號和密碼');
    expect(mockCheckClockRateLimit).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before destructuring quick-auth credentials', async () => {
    const request = new NextRequest('http://localhost/api/attendance/check-today', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"username":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockCheckClockRateLimit).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rate limits quick-auth attendance lookups before checking credentials', async () => {
    mockCheckClockRateLimit.mockResolvedValue({
      allowed: false,
      reason: '打卡請求過於頻繁，請稍後再試',
      retryAfter: 45
    });

    const request = new NextRequest('http://localhost/api/attendance/check-today', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(payload.error).toBe('打卡請求過於頻繁，請稍後再試');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts before returning attendance state', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'inactive.user',
      isActive: false,
      passwordHash: 'hash',
      employee: { id: 9, employeeId: 'E009', name: '停用員工', department: 'HR', position: 'Clerk' }
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/check-today', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'inactive.user', password: 'secret' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('帳號已停用，請聯繫管理員');
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockRecordFailedClockAttempt).not.toHaveBeenCalled();
    expect(mockClearFailedAttempts).not.toHaveBeenCalled();
  });

  it('does not increment failed_clock when background status checks receive a bad password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      isActive: true,
      passwordHash: 'hash',
      employee: { id: 9, employeeId: 'E009', name: 'Alice', department: 'HR', position: 'Clerk' }
    } as never);
    mockVerifyPassword.mockResolvedValue(false);

    const request = new NextRequest('http://localhost/api/attendance/check-today', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong-password' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('帳號或密碼錯誤');
    expect(mockRecordFailedClockAttempt).not.toHaveBeenCalled();
    expect(mockClearFailedAttempts).not.toHaveBeenCalled();
  });

  it('does not clear failed_clock when background status checks succeed', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      isActive: true,
      passwordHash: 'hash',
      employee: { id: 9, employeeId: 'E009', name: 'Alice', department: 'HR', position: 'Clerk' }
    } as never);
    mockVerifyPassword.mockResolvedValue(true);
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findFirst.mockResolvedValue(null as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/attendance/check-today', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret' })
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockRecordFailedClockAttempt).not.toHaveBeenCalled();
    expect(mockClearFailedAttempts).not.toHaveBeenCalled();
  });
});