jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    rateLimitRecord: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  verifyPassword: jest.fn(),
  generateToken: jest.fn(),
}));

jest.mock('@/lib/security', () => ({
  recordLoginAttempt: jest.fn(),
  isIPBlocked: jest.fn(),
  getRemainingBlockTime: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  applyRateLimit: jest.fn(),
  RateLimitError: class RateLimitError extends Error {
    retryAfter: number;

    constructor(message: string, retryAfter = 60) {
      super(message);
      this.retryAfter = retryAfter;
    }
  },
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/security-monitoring', () => ({
  logSecurityEvent: jest.fn(),
  SecurityEventType: {
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
    CSRF_VIOLATION: 'CSRF_VIOLATION',
    INPUT_VALIDATION_FAILED: 'INPUT_VALIDATION_FAILED',
    AUTHENTICATION_SUCCESS: 'AUTHENTICATION_SUCCESS',
    SYSTEM_ERROR: 'SYSTEM_ERROR',
  },
}));

jest.mock('@/lib/validation', () => ({
  validateRequest: jest.fn(),
  AuthSchemas: {
    login: {},
  },
}));

jest.mock('@/lib/login-logger', () => ({
  logLogin: jest.fn(),
  LOGIN_STATUS: {
    SUCCESS: 'SUCCESS',
    FAILED_NOT_FOUND: 'FAILED_NOT_FOUND',
    FAILED_INACTIVE: 'FAILED_INACTIVE',
    FAILED_PASSWORD: 'FAILED_PASSWORD',
    FAILED_LOCKED: 'FAILED_LOCKED',
    FAILED_2FA: 'FAILED_2FA',
  },
}));

jest.mock('@/lib/encryption', () => ({
  decrypt: jest.fn(),
  encrypt: jest.fn((value: string) => `encrypted:${value}`),
}));

jest.mock('@/lib/totp', () => ({
  verifyTOTP: jest.fn(),
  verifyBackupCode: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { generateToken, verifyPassword } from '@/lib/auth';
import { getRemainingBlockTime, isIPBlocked, recordLoginAttempt } from '@/lib/security';
import { validateCSRF } from '@/lib/csrf';
import { validateRequest } from '@/lib/validation';
import { decrypt } from '@/lib/encryption';
import { verifyBackupCode, verifyTOTP } from '@/lib/totp';
import { logLogin } from '@/lib/login-logger';
import { POST } from '../route';

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  rateLimitRecord: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};

const mockGenerateToken = generateToken as jest.MockedFunction<typeof generateToken>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockIsIPBlocked = isIPBlocked as jest.MockedFunction<typeof isIPBlocked>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;
const mockDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;
const mockVerifyTOTP = verifyTOTP as jest.MockedFunction<typeof verifyTOTP>;
const mockVerifyBackupCode = verifyBackupCode as jest.MockedFunction<typeof verifyBackupCode>;
const mockLogLogin = logLogin as jest.MockedFunction<typeof logLogin>;
const mockRecordLoginAttempt = recordLoginAttempt as jest.MockedFunction<typeof recordLoginAttempt>;
const mockGetRemainingBlockTime = getRemainingBlockTime as jest.MockedFunction<typeof getRemainingBlockTime>;

describe('/api/auth/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsIPBlocked.mockResolvedValue(false);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockValidateRequest.mockReturnValue({
      success: true,
      data: {
        username: 'alice',
        password: 'Password123!',
      },
    });
    mockVerifyPassword.mockResolvedValue(true);
    mockGenerateToken.mockReturnValue('signed-token');
    mockGetRemainingBlockTime.mockResolvedValue(60_000);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      employeeId: 99,
      isActive: true,
      passwordHash: 'hashed',
      twoFactorEnabled: false,
      twoFactorSecret: null,
      backupCodes: null,
      employee: {
        id: 99,
        employeeId: 'E001',
        name: 'Alice',
        department: 'HR',
        position: 'Manager',
      },
    });
    mockPrisma.user.update.mockResolvedValue(undefined);
    mockPrisma.rateLimitRecord.findUnique.mockResolvedValue(null);
    mockPrisma.rateLimitRecord.upsert.mockResolvedValue(undefined);
    mockDecrypt.mockImplementation((value: string) => value.replace(/^encrypted:/, ''));
    mockVerifyTOTP.mockReturnValue(false);
    mockVerifyBackupCode.mockReturnValue({ valid: false, remainingCodes: [] });
  });

  it('issues auth cookie without exposing token in response body', async () => {
    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'alice', password: 'Password123!' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      user: {
        id: 1,
        username: 'alice',
        role: 'ADMIN',
      },
    });
    expect(payload).not.toHaveProperty('token');
    expect(response.headers.get('set-cookie')).toContain('auth-token=signed-token');
  });

  it('returns a second-factor challenge when 2FA is enabled and no code is provided', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      employeeId: 99,
      isActive: true,
      passwordHash: 'hashed',
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted:secret',
      backupCodes: JSON.stringify(['encrypted:CODE-1']),
      employee: {
        id: 99,
        employeeId: 'E001',
        name: 'Alice',
        department: 'HR',
        position: 'Manager',
      },
    });

    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'alice', password: 'Password123!' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      requires2FA: true,
      message: '請輸入雙因素驗證碼或備用碼',
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  it('accepts an unused backup code and rotates the remaining backup code set', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      employeeId: 99,
      isActive: true,
      passwordHash: 'hashed',
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted:secret',
      backupCodes: JSON.stringify(['encrypted:CODE-1', 'encrypted:CODE-2']),
      employee: {
        id: 99,
        employeeId: 'E001',
        name: 'Alice',
        department: 'HR',
        position: 'Manager',
      },
    });
    mockVerifyBackupCode.mockReturnValue({
      valid: true,
      remainingCodes: ['CODE-2'],
    });

    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'alice', password: 'Password123!', totpCode: 'code-1' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true });
    expect(mockVerifyBackupCode).toHaveBeenCalledWith('CODE-1', ['CODE-1', 'CODE-2']);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        backupCodes: JSON.stringify(['encrypted:CODE-2']),
        currentSessionId: expect.any(String),
        lastLogin: expect.any(Date),
      }),
    });
    expect(response.headers.get('set-cookie')).toContain('auth-token=signed-token');
  });

  it('rejects replayed TOTP codes within the accepted window', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      employeeId: 99,
      isActive: true,
      passwordHash: 'hashed',
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted:secret',
      backupCodes: null,
      employee: {
        id: 99,
        employeeId: 'E001',
        name: 'Alice',
        department: 'HR',
        position: 'Manager',
      },
    });
    mockVerifyTOTP.mockReturnValue(true);
    mockPrisma.rateLimitRecord.findUnique.mockResolvedValue({
      key: 'replay',
      resetTime: new Date(Date.now() + 60_000),
    });

    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'alice', password: 'Password123!', totpCode: '123456' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '驗證碼已使用，請等待新的驗證碼' });
    expect(mockPrisma.rateLimitRecord.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockRecordLoginAttempt).toHaveBeenCalledWith(request, false);
    expect(mockLogLogin).toHaveBeenCalledWith(request, 'alice', 'FAILED_2FA', 1, '2FA驗證碼重放');
  });

  it('counts inactive-account login attempts toward IP blocking and logs the inactive status', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      employeeId: 99,
      isActive: false,
      passwordHash: 'hashed',
      twoFactorEnabled: false,
      twoFactorSecret: null,
      backupCodes: null,
      employee: null,
    });

    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'alice', password: 'Password123!' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '帳號已停用，請聯繫管理員' });
    expect(mockRecordLoginAttempt).toHaveBeenCalledWith(request, false);
    expect(mockLogLogin).toHaveBeenCalledWith(request, 'alice', 'FAILED_INACTIVE', 1, '帳號已停用');
  });

  it('logs blocked login attempts as locked failures when a username was provided', async () => {
    mockIsIPBlocked.mockResolvedValue(true);

    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'alice', password: 'Password123!' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({ error: 'IP已被暫時封鎖，請在1分鐘後再試' });
    expect(mockLogLogin).toHaveBeenCalledWith(request, 'alice', 'FAILED_LOCKED', undefined, 'IP已被暫時封鎖');
    expect(mockValidateCSRF).not.toHaveBeenCalled();
  });

  it('records invalid second-factor submissions with the dedicated FAILED_2FA status', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      employeeId: 99,
      isActive: true,
      passwordHash: 'hashed',
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted:secret',
      backupCodes: JSON.stringify(['encrypted:CODE-1']),
      employee: {
        id: 99,
        employeeId: 'E001',
        name: 'Alice',
        department: 'HR',
        position: 'Manager',
      },
    });

    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'alice', password: 'Password123!', totpCode: 'BADCODE1' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '驗證碼或備用碼錯誤' });
    expect(mockRecordLoginAttempt).toHaveBeenCalledWith(request, false);
    expect(mockLogLogin).toHaveBeenCalledWith(request, 'alice', 'FAILED_2FA', 1, '2FA驗證碼或備用碼錯誤');
  });
});
