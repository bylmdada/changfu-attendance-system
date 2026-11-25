jest.mock('@/lib/database', () => ({
  prisma: {
    smtpSettings: { findFirst: jest.fn() },
    systemNotificationSettings: { findFirst: jest.fn() },
    inAppNotification: { create: jest.fn() },
    annualLeave: { findMany: jest.fn() },
    leaveExpiryReminderLog: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));

const sendMail = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail })) },
}));

import { prisma } from '@/lib/database';
import { sendAnnualLeaveExpiryReminders } from '@/lib/email';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

const settings = (emailEnabled: boolean, inAppEnabled: boolean) => ({
  emailEnabled,
  inAppEnabled,
  leaveApprovalNotify: true,
  overtimeApprovalNotify: true,
  shiftApprovalNotify: true,
  annualLeaveExpiryNotify: true,
  annualLeaveExpiryDays: 30,
  reminderStages: null,
});

describe('annual leave expiry reminders record what was really delivered', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-25T04:00:00.000Z'));

    mockPrisma.smtpSettings.findFirst.mockResolvedValue({
      smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecure: false, smtpUser: 'mailer@example.com',
      smtpPassword: 'secret', fromName: '考勤', fromEmail: 'mailer@example.com',
    } as never);
    // 6 天後到期、剩 3 天，員工有信箱
    mockPrisma.annualLeave.findMany.mockResolvedValue([{
      id: 5, year: 2026, remainingDays: 3, expiryDate: new Date('2026-12-01T00:00:00.000Z'),
      employee: { id: 1, name: '王小明', email: 'staff@example.com' },
    }] as never);
    mockPrisma.leaveExpiryReminderLog.findUnique.mockResolvedValue(null as never);
    mockPrisma.leaveExpiryReminderLog.upsert.mockResolvedValue({} as never);
    mockPrisma.inAppNotification.create.mockResolvedValue({} as never);
    sendMail.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('skips the reminder and records nothing when every channel is off', async () => {
    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue(settings(false, false) as never);

    const result = await sendAnnualLeaveExpiryReminders();

    expect(result).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(mockPrisma.leaveExpiryReminderLog.upsert).not.toHaveBeenCalled(); // 不會因為沒送出而延後下次提醒
    expect(sendMail).not.toHaveBeenCalled();
    expect(mockPrisma.inAppNotification.create).not.toHaveBeenCalled();
  });

  it('records only the e-mail channel when only e-mail is on', async () => {
    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue(settings(true, false) as never);

    const result = await sendAnnualLeaveExpiryReminders();

    expect(result).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
    expect(mockPrisma.leaveExpiryReminderLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ channel: 'EMAIL' }),
    }));
  });

  it('records only the in-app channel when only in-app is on', async () => {
    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue(settings(false, true) as never);

    const result = await sendAnnualLeaveExpiryReminders();

    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(mockPrisma.leaveExpiryReminderLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ channel: 'IN_APP' }),
    }));
  });

  it('counts a failed delivery as failed, records nothing, and keeps the error so the next run retries it', async () => {
    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue(settings(false, true) as never);
    mockPrisma.inAppNotification.create.mockRejectedValue(new Error('db down') as never);

    const result = await sendAnnualLeaveExpiryReminders();

    expect(result).toMatchObject({ sent: 0, skipped: 0, failed: 1 });
    expect(result.errors[0]).toContain('王小明');
    expect(mockPrisma.leaveExpiryReminderLog.upsert).not.toHaveBeenCalled();
  });

  it('records the channel that worked when the other one fails, and reports the failure', async () => {
    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue(settings(true, true) as never);
    sendMail.mockRejectedValue(new Error('smtp down'));

    const result = await sendAnnualLeaveExpiryReminders();

    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(result.errors).toHaveLength(1);
    expect(mockPrisma.leaveExpiryReminderLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ channel: 'IN_APP' }),
    }));
  });
});
