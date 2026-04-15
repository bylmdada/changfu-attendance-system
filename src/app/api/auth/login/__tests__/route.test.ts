jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
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
  },
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { generateToken, verifyPassword } from '@/lib/auth';
import { isIPBlocked } from '@/lib/security';
import { validateCSRF } from '@/lib/csrf';
import { validateRequest } from '@/lib/validation';
import { POST } from '../route';

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const mockGenerateToken = generateToken as jest.MockedFunction<typeof generateToken>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockIsIPBlocked = isIPBlocked as jest.MockedFunction<typeof isIPBlocked>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;

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
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      role: 'ADMIN',
      employeeId: 99,
      isActive: true,
      passwordHash: 'hashed',
      twoFactorEnabled: false,
      employee: {
        id: 99,
        employeeId: 'E001',
        name: 'Alice',
        department: 'HR',
        position: 'Manager',
      },
    });
    mockPrisma.user.update.mockResolvedValue(undefined);
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
});