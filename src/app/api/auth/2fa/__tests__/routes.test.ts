jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/totp', () => ({
  generateTOTPSecret: jest.fn(),
  generateQRCode: jest.fn(),
  generateBackupCodes: jest.fn(),
  verifyTOTP: jest.fn()
}));

jest.mock('@/lib/encryption', () => ({
  encrypt: jest.fn((value: string) => `encrypted:${value}`),
  decrypt: jest.fn((value: string) => value)
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn()
}));

import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { generateTOTPSecret, generateQRCode, generateBackupCodes, verifyTOTP } from '@/lib/totp';
import { decrypt } from '@/lib/encryption';
import bcrypt from 'bcryptjs';
import { POST as setup2FA } from '../setup/route';
import { POST as verify2FA } from '../verify/route';
import { POST as disable2FA } from '../disable/route';
import { GET as get2FAStatus } from '../status/route';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGenerateTOTPSecret = generateTOTPSecret as jest.MockedFunction<typeof generateTOTPSecret>;
const mockGenerateQRCode = generateQRCode as jest.MockedFunction<typeof generateQRCode>;
const mockGenerateBackupCodes = generateBackupCodes as jest.MockedFunction<typeof generateBackupCodes>;
const mockVerifyTOTP = verifyTOTP as jest.MockedFunction<typeof verifyTOTP>;
const mockDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;
const mockBcryptCompare = bcrypt.compare as jest.MockedFunction<typeof bcrypt.compare>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('secure 2FA routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({
      userId: 42,
      username: 'staff.user',
      role: 'USER'
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('allows non-admin users to start secure 2FA setup', async () => {
    mockGenerateTOTPSecret.mockReturnValue('plain-secret');
    mockGenerateQRCode.mockResolvedValue('data:image/png;base64,qr-code');
    mockGenerateBackupCodes.mockReturnValue(['CODE-1', 'CODE-2']);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 42,
      username: 'staff.user',
      role: 'USER',
      employee: { id: 7, name: '一般員工' }
    } as never);
    mockPrisma.user.update.mockResolvedValue({ id: 42 } as never);

    const response = await setup2FA(new Request('http://localhost/api/auth/2fa/setup', {
      method: 'POST'
    }) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.secret).toBe('plain-secret');
    expect(payload.backupCodes).toEqual(['CODE-1', 'CODE-2']);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        twoFactorSecret: 'encrypted:plain-secret',
        backupCodes: JSON.stringify(['encrypted:CODE-1', 'encrypted:CODE-2'])
      }
    });
  });

  it('marks 2FA as optional for regular users in status endpoint', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      twoFactorEnabled: true,
      role: 'USER'
    } as never);

    const response = await get2FAStatus(new Request('http://localhost/api/auth/2fa/status') as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      enabled: true,
      required: false,
      role: 'USER'
    });
  });

  it('keeps 2FA required for HR and admins in status endpoint', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      twoFactorEnabled: false,
      role: 'HR'
    } as never);

    const response = await get2FAStatus(new Request('http://localhost/api/auth/2fa/status') as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      enabled: false,
      required: true,
      role: 'HR'
    });
  });

  it('returns 400 for malformed JSON in verify route instead of bubbling a 500', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await verify2FA(new Request('http://localhost/api/auth/2fa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    }) as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockVerifyTOTP).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('returns 400 for malformed JSON in disable route instead of bubbling a 500', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await disable2FA(new Request('http://localhost/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    }) as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockBcryptCompare).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});