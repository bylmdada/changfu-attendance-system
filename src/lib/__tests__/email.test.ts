jest.mock('@/lib/database', () => ({
  prisma: {
    smtpSettings: {
      findFirst: jest.fn(),
    },
    systemNotificationSettings: {
      findFirst: jest.fn(),
    },
    inAppNotification: {
      create: jest.fn(),
    },
  },
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

import { prisma } from '@/lib/database';
import { sendNotification } from '@/lib/email';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('email notification sanitization', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockPrisma.smtpSettings.findFirst.mockResolvedValue({
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'super-secret',
      fromName: '長福會考勤系統',
      fromEmail: 'mailer@example.com',
    } as never);

    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue({
      emailEnabled: true,
      inAppEnabled: false,
      leaveApprovalNotify: true,
      overtimeApprovalNotify: true,
      shiftApprovalNotify: true,
      annualLeaveExpiryNotify: true,
      annualLeaveExpiryDays: 30,
    } as never);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not return raw smtp errors from sendNotification', async () => {
    sendMail.mockRejectedValue(
      Object.assign(
        new Error('535 Invalid login for mailer@example.com via smtp.example.com'),
        { code: 'EAUTH', responseCode: 535 }
      )
    );

    const result = await sendNotification({
      type: 'ANNUAL_LEAVE_EXPIRY',
      recipientEmployeeId: 1,
      recipientEmail: 'employee@example.com',
      recipientName: '王小明',
      title: '年假即將到期提醒',
      message: 'test message',
    });

    expect(result).toEqual({
      success: false,
      emailSent: false,
      inAppSent: false,
      errors: ['郵件: 郵件發送失敗，請檢查 SMTP 設定後再試'],
    });
    expect(result.errors[0]).not.toContain('535 Invalid login');
    expect(result.errors[0]).not.toContain('smtp.example.com');
    expect(result.errors[0]).not.toContain('mailer@example.com');

    expect(consoleErrorSpy).toHaveBeenCalledWith('郵件發送失敗:', {
      code: 'EAUTH',
      responseCode: 535,
    });
  });

  it('treats whitespace-only smtp host values as not configured', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue({
      smtpHost: '   ',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'super-secret',
      fromName: '長福考勤系統',
      fromEmail: 'mailer@example.com',
    } as never);

    const result = await sendNotification({
      type: 'ANNUAL_LEAVE_EXPIRY',
      recipientEmployeeId: 1,
      recipientEmail: 'employee@example.com',
      recipientName: '王小明',
      title: '年假即將到期提醒',
      message: 'test message',
    });

    expect(result).toEqual({
      success: false,
      emailSent: false,
      inAppSent: false,
      errors: ['郵件: SMTP 未設定'],
    });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
