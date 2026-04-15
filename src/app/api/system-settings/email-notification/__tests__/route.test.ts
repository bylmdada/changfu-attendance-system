jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('email notification route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
    mockGetUserFromToken.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'email_notification_settings',
      value: JSON.stringify({
        enabled: true,
        smtpHost: 'smtp.example.com',
        smtpPass: 'secret',
        notifyLeaveApproval: true,
        notifyOvertimeApproval: true,
        notifyScheduleChange: true,
        notifyPasswordReset: true
      })
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.smtpPass).toBe('********');
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'email_notification_settings',
      value: JSON.stringify({ enabled: true })
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        enabled: true,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: 'mailer',
        smtpPass: 'secret',
        senderName: '長福考勤系統',
        senderEmail: 'hr@example.com',
        notifyLeaveApproval: true,
        notifyOvertimeApproval: true,
        notifyScheduleChange: true,
        notifyPasswordReset: true
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('Email 通知設定已更新');
  });

  it('falls back to default settings when stored JSON is malformed on GET', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'email_notification_settings',
      value: '{bad-json'
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.enabled).toBe(false);
    expect(payload.settings.smtpPass).toBe('');
  });

  it('rejects null request bodies on POST before touching persistence', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies on POST before touching persistence', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: '{"enabled":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});