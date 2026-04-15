jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/totp', () => ({
  generateTOTPSecret: jest.fn(),
  generateQRCode: jest.fn(),
  generateBackupCodes: jest.fn(),
}));

jest.mock('@/lib/encryption', () => ({
  encrypt: jest.fn((value: string) => `encrypted:${value}`),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/2fa/setup/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('2fa setup csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('rejects POST when csrf validation fails before generating 2FA secrets', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const response = await POST(new NextRequest('http://localhost/api/auth/2fa/setup', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=session-token',
      },
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects setup when 2FA is already enabled', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      twoFactorEnabled: true,
      employee: { id: 10, name: 'Admin User' },
    } as never);

    const response = await POST(new NextRequest('http://localhost/api/auth/2fa/setup', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=session-token',
      },
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain('已啟用');
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });
});