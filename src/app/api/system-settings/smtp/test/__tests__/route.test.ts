jest.mock('@/lib/database', () => ({
  prisma: {
    smtpSettings: {
      findFirst: jest.fn(),
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

const sendMail = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({
      sendMail,
    })),
  },
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('smtp test route', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMail.mockResolvedValue({ messageId: 'test-message' });
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.smtpSettings.findFirst.mockResolvedValue({
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'secret',
      fromEmail: 'noreply@example.com',
      fromName: '長福考勤系統',
    } as never);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('sends a test email when smtp settings are configured', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/smtp/test', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({ email: 'tester@example.com' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'tester@example.com',
      subject: '長福考勤系統 SMTP 測試郵件',
    }));
  });

  it('rejects null POST bodies before reading smtp test payload fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/smtp/test', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的測試郵件地址' });
    expect(mockPrisma.smtpSettings.findFirst).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON POST bodies before reading smtp test payload fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/smtp/test', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"email":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.smtpSettings.findFirst).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not leak underlying smtp errors to the client', async () => {
    const smtpError = Object.assign(
      new Error('535 Invalid login for mailer@example.com via smtp.example.com'),
      { code: 'EAUTH', responseCode: 535 }
    );
    sendMail.mockRejectedValue(smtpError);

    const request = new NextRequest('http://localhost/api/system-settings/smtp/test', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({ email: 'tester@example.com' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('測試郵件發送失敗，請檢查 SMTP 設定後再試');
    expect(payload.error).not.toContain('535 Invalid login');
    expect(payload.error).not.toContain('smtp.example.com');
    expect(payload.error).not.toContain('mailer@example.com');
    expect(consoleErrorSpy).toHaveBeenCalledWith('SMTP 測試郵件發送失敗:', {
      name: 'Error',
      code: 'EAUTH',
      responseCode: 535,
    });
  });
});