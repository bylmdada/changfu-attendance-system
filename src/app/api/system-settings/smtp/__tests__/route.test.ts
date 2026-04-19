jest.mock('@/lib/database', () => ({
  prisma: {
    smtpSettings: {
      findFirst: jest.fn(),
      create: jest.fn(),
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('smtp settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('returns in-memory defaults instead of creating a row on first GET', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      id: 0,
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: true,
      smtpPassword: '',
    });
    expect(mockPrisma.smtpSettings.create).not.toHaveBeenCalled();
  });

  it('masks existing smtp password on GET', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue({
      id: 7,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'secret',
      fromEmail: 'noreply@example.com',
      fromName: '長福考勤系統',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings.smtpPassword).toBe('********');
  });

  it('rejects null bodies on POST before destructuring smtp fields', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
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
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.smtpSettings.create).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.update).not.toHaveBeenCalled();
  });

  it('rejects unauthorized POST requests before invoking csrf validation', async () => {
    mockGetUserFromRequest.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpSecure: true,
        smtpUser: 'mailer@example.com',
        smtpPassword: 'secret',
        fromEmail: 'noreply@example.com',
        fromName: '長福考勤系統',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '無權限訪問' });
    expect(mockValidateCSRF).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.findFirst).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON POST bodies before reading smtp fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"smtpHost":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.smtpSettings.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.create).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.update).not.toHaveBeenCalled();
  });

  it('normalizes SMTP settings and preserves the stored password when the masked placeholder is submitted', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue({
      id: 7,
      smtpHost: 'old.smtp.example.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUser: 'old-user',
      smtpPassword: 'stored-secret',
      fromEmail: 'old@example.com',
      fromName: '舊寄件人',
    } as never);
    mockPrisma.smtpSettings.update.mockResolvedValue({
      id: 7,
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'stored-secret',
      fromEmail: 'noreply@example.com',
      fromName: '長福考勤系統',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        smtpHost: '  smtp.example.com  ',
        smtpPort: '465',
        smtpSecure: false,
        smtpUser: '  mailer@example.com  ',
        smtpPassword: '********',
        fromEmail: '  noreply@example.com  ',
        fromName: '  長福考勤系統  ',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.smtpSettings.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpSecure: false,
        smtpUser: 'mailer@example.com',
        fromEmail: 'noreply@example.com',
        fromName: '長福考勤系統',
      }
    });
    expect(payload.settings).toMatchObject({
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpPassword: '********',
      fromEmail: 'noreply@example.com',
      fromName: '長福考勤系統',
    });
  });

  it('rejects POST when the required SMTP fields are blank', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        smtpHost: '   ',
        smtpPort: 587,
        smtpSecure: true,
        smtpUser: 'mailer@example.com',
        smtpPassword: 'secret',
        fromEmail: 'noreply@example.com',
        fromName: '長福考勤系統',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'SMTP 主機不可為空' });
    expect(mockPrisma.smtpSettings.create).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.update).not.toHaveBeenCalled();
  });

  it('rejects invalid smtp ports before writing settings', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        smtpHost: 'smtp.example.com',
        smtpPort: 70000,
        smtpSecure: true,
        smtpUser: 'mailer@example.com',
        smtpPassword: 'secret',
        fromEmail: 'noreply@example.com',
        fromName: '長福考勤系統',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'SMTP 埠號必須是 1 到 65535 之間的整數' });
    expect(mockPrisma.smtpSettings.create).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.update).not.toHaveBeenCalled();
  });
});
