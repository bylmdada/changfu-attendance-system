jest.mock('@/lib/database', () => ({
  prisma: {
    payslipEmailSettings: {
      findFirst: jest.fn(),
    },
    payrollRecord: {
      findMany: jest.fn(),
    },
    payslipSendHistory: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
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
import { validateCSRF } from '@/lib/csrf';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('payroll send email route', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'hr-admin',
      role: 'HR',
      employeeId: 9001,
    } as never);

    mockPrisma.payslipEmailSettings.findFirst.mockResolvedValue({
      enabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'super-secret',
      fromEmail: 'payroll@example.com',
      fromName: 'Payroll Bot',
      subjectTemplate: '%YEAR%/%MONTH% 薪資條',
      bodyTemplate: 'Hi %NAME% - %YEAR%/%MONTH%',
    } as never);

    mockPrisma.payrollRecord.findMany.mockResolvedValue([
      {
        id: 101,
        payYear: 2024,
        payMonth: 8,
        employee: {
          id: 501,
          employeeId: 'EMP001',
          name: '王小明',
          email: 'employee@example.com',
        },
      },
    ] as never);

    mockPrisma.payslipSendHistory.create.mockResolvedValue({ id: 1 } as never);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not leak raw smtp errors in the response, history, or logs', async () => {
    const smtpError = Object.assign(
      new Error('535 Invalid login for mailer@example.com via smtp.example.com'),
      { code: 'EAUTH', responseCode: 535 }
    );
    sendMail.mockRejectedValue(smtpError);

    const request = new NextRequest('http://localhost/api/payroll/send-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        payrollIds: [101],
        year: 2024,
        month: 8,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.results).toEqual({
      success: 0,
      failed: 1,
      errors: ['王小明: 郵件發送失敗，請檢查 SMTP 設定後再試'],
    });
    expect(payload.results.errors[0]).not.toContain('535 Invalid login');
    expect(payload.results.errors[0]).not.toContain('smtp.example.com');
    expect(payload.results.errors[0]).not.toContain('mailer@example.com');

    expect(mockPrisma.payslipSendHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payrollId: 101,
        employeeId: 501,
        status: 'FAILED',
        errorMessage: '郵件發送失敗，請檢查 SMTP 設定後再試',
        sentBy: 'hr-admin',
      }),
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('薪資條 Email 發送失敗:', {
      payrollId: 101,
      employeeId: 501,
      code: 'EAUTH',
      responseCode: 535,
    });
  });

  it('returns 400 for malformed email request JSON before loading SMTP settings', async () => {
    const request = new NextRequest('http://localhost/api/payroll/send-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: '{',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.payslipEmailSettings.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });
});