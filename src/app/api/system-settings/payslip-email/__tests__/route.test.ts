jest.mock('@/lib/database', () => ({
  prisma: {
    payslipEmailSettings: {
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
import { GET, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('payslip email settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
  });

  it('returns defaults without creating a settings row on first GET', async () => {
    mockPrisma.payslipEmailSettings.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/payslip-email', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings).toMatchObject({
      id: 0,
      enabled: false,
      smtpPort: 587,
      smtpSecure: true,
      fromName: '薪資系統',
      subjectTemplate: '[%YEAR%年%MONTH%月] 薪資條通知',
      smtpPassword: null,
    });
    expect(mockPrisma.payslipEmailSettings.create).not.toHaveBeenCalled();
  });

  it('masks stored smtp password on GET', async () => {
    mockPrisma.payslipEmailSettings.findFirst.mockResolvedValue({
      id: 11,
      enabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'secret',
      fromEmail: 'noreply@example.com',
      fromName: '薪資系統',
      subjectTemplate: '[%YEAR%年%MONTH%月] 薪資條通知',
      bodyTemplate: 'body',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/payslip-email', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings.smtpPassword).toBe('********');
  });

  it('rejects null PUT bodies before destructuring email settings fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/payslip-email', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的設定資料');
    expect(mockPrisma.payslipEmailSettings.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.payslipEmailSettings.update).not.toHaveBeenCalled();
    expect(mockPrisma.payslipEmailSettings.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PUT bodies before reading email settings fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/payslip-email', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"enabled":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.payslipEmailSettings.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.payslipEmailSettings.update).not.toHaveBeenCalled();
    expect(mockPrisma.payslipEmailSettings.create).not.toHaveBeenCalled();
  });

  it('rejects invalid field types before updating settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/payslip-email', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        enabled: 'true',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('啟用設定格式無效');
    expect(mockPrisma.payslipEmailSettings.findFirst).toHaveBeenCalledTimes(1);
    expect(mockPrisma.payslipEmailSettings.update).not.toHaveBeenCalled();
    expect(mockPrisma.payslipEmailSettings.create).not.toHaveBeenCalled();
  });

  it('preserves omitted fields when updating only the templates', async () => {
    mockPrisma.payslipEmailSettings.findFirst.mockResolvedValue({
      id: 11,
      enabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'secret',
      fromEmail: 'noreply@example.com',
      fromName: '薪資系統',
      subjectTemplate: 'old subject',
      bodyTemplate: 'old body',
    } as never);
    mockPrisma.payslipEmailSettings.update.mockResolvedValue({
      id: 11,
      enabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'secret',
      fromEmail: 'noreply@example.com',
      fromName: '薪資系統',
      subjectTemplate: 'new subject',
      bodyTemplate: 'new body',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/payslip-email', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        subjectTemplate: 'new subject',
        bodyTemplate: 'new body',
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.payslipEmailSettings.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        enabled: true,
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpSecure: false,
        smtpUser: 'mailer@example.com',
        fromEmail: 'noreply@example.com',
        fromName: '薪資系統',
        subjectTemplate: 'new subject',
        bodyTemplate: 'new body',
      }),
    });
  });
});
