jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('password policy route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'password_policy',
      value: JSON.stringify({ minLength: 6 }),
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      role: 'ADMIN',
    } as never);
  });

  it('rejects unauthenticated GET requests before reading policy settings', async () => {
    mockGetUserFromRequest.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-policy');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('allows authenticated non-admin GET requests so users can read the active policy', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 7,
      username: 'staff',
      role: 'EMPLOYEE',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_policy',
      value: JSON.stringify({
        minLength: 14,
        requireSpecialChars: true,
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-policy');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.policy).toMatchObject({
      minLength: 14,
      requireSpecialChars: true,
    });
  });

  it('falls back to defaults when stored password policy JSON is malformed', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_policy',
      value: '{bad-json',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-policy');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.policy).toMatchObject({
      minLength: 6,
      expirationMonths: 0,
      maxFailedAttempts: 5,
    });
  });

  it('sanitizes corrupted stored password policy field types on GET', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_policy',
      value: JSON.stringify({
        minLength: '12',
        requireUppercase: 'yes',
        customBlockedPasswords: [' 123456 ', 42],
        maxFailedAttempts: '3',
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-policy');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.policy).toMatchObject({
      minLength: 6,
      requireUppercase: false,
      maxFailedAttempts: 5,
    });
    expect(payload.policy.customBlockedPasswords).toEqual([]);
  });

  it('preserves existing password policy fields on partial POST updates', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_policy',
      value: JSON.stringify({
        minLength: 10,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: false,
        expirationMonths: 12,
        preventPasswordReuse: true,
        passwordHistoryCount: 8,
        preventSequentialChars: false,
        preventBirthdate: false,
        preventCommonPasswords: true,
        customBlockedPasswords: ['123456'],
        enableStrengthMeter: true,
        minimumStrengthScore: 3,
        allowAdminExceptions: false,
        requireExceptionReason: false,
        enablePasswordHints: true,
        lockoutAfterFailedAttempts: true,
        maxFailedAttempts: 3,
        lockoutDurationMinutes: 45,
        enableTwoFactorAuth: true,
        notifyPasswordExpiration: false,
        notificationDaysBefore: 14,
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-policy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        policy: {
          minLength: 12,
          notificationDaysBefore: 10,
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.policy).toMatchObject({
      minLength: 12,
      expirationMonths: 12,
      maxFailedAttempts: 3,
      enableTwoFactorAuth: true,
      notificationDaysBefore: 10,
    });
    expect(payload.policy.customBlockedPasswords).toEqual(['123456']);
  });

  it('rejects null bodies on POST before destructuring password policy payload', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-policy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on POST before reading existing password policy', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-policy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"policy": {"minLength": 10}',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid boolean field types on POST before reading existing password policy', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-policy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        policy: {
          requireUppercase: 'true',
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'requireUppercase格式無效' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});