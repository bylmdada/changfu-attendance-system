jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    passwordHistory: {
      findMany: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    }
  }
}));

import { NextRequest } from 'next/server';
import { POST, PUT } from '@/app/api/password/route';
import { getUserFromRequest, verifyPassword, hashPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockHashPassword = hashPassword as jest.MockedFunction<typeof hashPassword>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('/api/password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockVerifyPassword.mockImplementation(async (password, hashedPassword) => (
      password === 'Old123!!' && hashedPassword === 'old-hash'
    ));
    mockHashPassword.mockResolvedValue('hashed-password');
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.passwordHistory.findMany.mockResolvedValue([] as never);
  });

  it('rejects PUT when the request is not authenticated', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ currentPassword: 'Old123!!', newPassword: 'Nex!Pass77' })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '未授權訪問' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null PUT bodies before destructuring password change fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: 'null'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '當前密碼和新密碼為必填' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockHashPassword).not.toHaveBeenCalled();
  });

  it('rejects malformed PUT JSON before destructuring password change fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"currentPassword":'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockHashPassword).not.toHaveBeenCalled();
  });

  it('allows only ADMIN and HR to reset another user password', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ userId: '8', newPassword: 'Nex!Pass77' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '權限不足' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before destructuring password reset fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'admin',
      role: 'ADMIN'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '用戶ID和新密碼為必填' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockHashPassword).not.toHaveBeenCalled();
  });

  it('rejects malformed POST JSON before destructuring password reset fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'admin',
      role: 'ADMIN'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"userId":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockHashPassword).not.toHaveBeenCalled();
  });

  it('applies the stored password policy when users change their own password', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      username: 'employee',
      passwordHash: 'old-hash',
      currentSessionId: 'session-1',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_policy',
      value: JSON.stringify({
        minLength: 12,
        requireUppercase: false,
        requireLowercase: false,
        requireNumbers: false,
        requireSpecialChars: false,
        expirationMonths: 0,
        preventPasswordReuse: false,
        passwordHistoryCount: 5,
        preventSequentialChars: false,
        preventBirthdate: false,
        preventCommonPasswords: false,
        customBlockedPasswords: [],
        enableStrengthMeter: false,
        minimumStrengthScore: 1,
        allowAdminExceptions: true,
        requireExceptionReason: true,
        enablePasswordHints: false,
        lockoutAfterFailedAttempts: true,
        maxFailedAttempts: 5,
        lockoutDurationMinutes: 30,
        enableTwoFactorAuth: false,
        notifyPasswordExpiration: true,
        notificationDaysBefore: 7,
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ currentPassword: 'Old123!!', newPassword: 'Short123!' })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '密碼不符合安全要求',
      details: ['密碼長度至少需要12位']
    });
    expect(mockHashPassword).not.toHaveBeenCalled();
  });

  it('invalidates the current session after a successful password change', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_policy',
      value: JSON.stringify({
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        allowedSpecialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
        expirationMonths: 0,
        preventPasswordReuse: false,
        passwordHistoryCount: 5,
        preventSequentialChars: false,
        preventBirthdate: false,
        preventCommonPasswords: false,
        customBlockedPasswords: [],
        enableStrengthMeter: false,
        minimumStrengthScore: 1,
        allowAdminExceptions: true,
        requireExceptionReason: true,
        enablePasswordHints: false,
        lockoutAfterFailedAttempts: true,
        maxFailedAttempts: 5,
        lockoutDurationMinutes: 30,
        enableTwoFactorAuth: false,
        notifyPasswordExpiration: true,
        notificationDaysBefore: 7,
      }),
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      username: 'employee',
      passwordHash: 'old-hash',
      currentSessionId: 'session-1',
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ currentPassword: 'Old123!!', newPassword: 'New123!!' })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      message: '密碼修改成功，請重新登入',
      requireRelogin: true
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        passwordHash: 'hashed-password',
        currentSessionId: null,
        passwordHistories: {
          create: {
            passwordHash: 'old-hash'
          }
        }
      }
    });
  });

  it('rejects malformed reset user ids instead of partially parsing them', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'admin',
      role: 'ADMIN'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ userId: '8abc', newPassword: 'New123!!' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '用戶ID格式無效' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('invalidates the target session after an admin reset and falls back to username when employee data is missing', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'admin',
      role: 'ADMIN'
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_policy',
      value: JSON.stringify({
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        allowedSpecialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
        expirationMonths: 0,
        preventPasswordReuse: false,
        passwordHistoryCount: 5,
        preventSequentialChars: false,
        preventBirthdate: false,
        preventCommonPasswords: false,
        customBlockedPasswords: [],
        enableStrengthMeter: false,
        minimumStrengthScore: 1,
        allowAdminExceptions: true,
        requireExceptionReason: true,
        enablePasswordHints: false,
        lockoutAfterFailedAttempts: true,
        maxFailedAttempts: 5,
        lockoutDurationMinutes: 30,
        enableTwoFactorAuth: false,
        notifyPasswordExpiration: true,
        notificationDaysBefore: 7,
      }),
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 8,
      username: 'target-user',
      passwordHash: 'old-hash',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ userId: '8', newPassword: 'New123!!' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      message: '已重置用戶 target-user 的密碼'
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: {
        passwordHash: 'hashed-password',
        currentSessionId: null,
        passwordHistories: {
          create: {
            passwordHash: 'old-hash'
          }
        }
      }
    });
  });

  it('rejects password reuse when policy blocks reusing the current or recent passwords', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_policy',
      value: JSON.stringify({
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        allowedSpecialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
        expirationMonths: 0,
        preventPasswordReuse: true,
        passwordHistoryCount: 5,
        preventSequentialChars: false,
        preventBirthdate: false,
        preventCommonPasswords: false,
        customBlockedPasswords: [],
        enableStrengthMeter: false,
        minimumStrengthScore: 1,
        allowAdminExceptions: true,
        requireExceptionReason: true,
        enablePasswordHints: false,
        lockoutAfterFailedAttempts: true,
        maxFailedAttempts: 5,
        lockoutDurationMinutes: 30,
        enableTwoFactorAuth: false,
        notifyPasswordExpiration: true,
        notificationDaysBefore: 7,
      }),
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      username: 'employee',
      passwordHash: 'old-hash',
      currentSessionId: 'session-1',
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ currentPassword: 'Old123!!', newPassword: 'Old123!!' })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '密碼不符合安全要求',
      details: ['不可重複使用目前密碼或最近 5 次密碼']
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
