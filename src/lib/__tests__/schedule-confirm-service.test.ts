const mockPrisma = {
  systemSettings: {
    findMany: jest.fn()
  },
  scheduleMonthlyRelease: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  scheduleConfirmation: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn()
  },
  employee: {
    findUnique: jest.fn(),
    findMany: jest.fn()
  },
  schedule: {
    findFirst: jest.fn()
  },
  notification: {
    create: jest.fn()
  }
};

jest.mock('@/lib/database', () => ({
  prisma: mockPrisma
}));

jest.mock('@/lib/realtime-notifications', () => ({
  sendNotification: jest.fn(),
}));

import { sendNotification } from '@/lib/realtime-notifications';
import {
  canEmployeeClockIn,
  invalidateConfirmation,
  sendReminderToUnconfirmed,
  sendSchedulePublishNotification,
} from '@/lib/schedule-confirm-service';

const mockSendNotification = sendNotification as jest.MockedFunction<typeof sendNotification>;

describe('invalidateConfirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.schedule.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([]);
    mockPrisma.scheduleConfirmation.findMany.mockResolvedValue([]);
    mockPrisma.employee.findMany.mockResolvedValue([]);
    mockSendNotification.mockResolvedValue('notification-1');
  });

  it('blocks clock-in when the active month has not been published yet', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.blockClock', value: 'true' }
    ]);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 7, department: '行政部' });
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null);
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 1001 });

    await expect(canEmployeeClockIn(7, new Date('2026-04-10T08:00:00.000Z'))).resolves.toEqual({
      allowed: false,
      reason: '本月班表尚未發布，請聯繫排班管理員'
    });
    expect(mockPrisma.scheduleConfirmation.findUnique).not.toHaveBeenCalled();
  });

  it('allows clock-in when the employee has no schedule to confirm in that month', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.blockClock', value: 'true' }
    ]);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 7, department: '行政部' });
    mockPrisma.schedule.findFirst.mockResolvedValue(null);

    await expect(canEmployeeClockIn(7, new Date('2026-04-10T08:00:00.000Z'))).resolves.toEqual({ allowed: true });
    expect(mockPrisma.scheduleMonthlyRelease.findMany).not.toHaveBeenCalled();
  });

  it('uses the Taiwan month during the first eight hours of a month', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.blockClock', value: 'true' }
    ]);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 7, department: '行政部' });
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 1001 });
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([{ id: 88, version: 1, department: '行政部', publishedAt: new Date() }]);
    mockPrisma.scheduleConfirmation.findUnique.mockResolvedValue(null);

    await canEmployeeClockIn(7, new Date('2026-07-31T16:30:00.000Z'));

    expect(mockPrisma.schedule.findFirst).toHaveBeenCalledWith({
      where: { employeeId: 7, workDate: { startsWith: '2026-08-' } },
      select: { id: true },
    });
    expect(mockPrisma.scheduleMonthlyRelease.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ yearMonth: '2026-08' }),
    }));
  });

  it('uses the department release even when a global release was published later', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.blockClock', value: 'true' }
    ]);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 7, department: '行政部' });
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 1001 });
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([
      { id: 80, version: 2, department: null, publishedAt: new Date('2026-04-10T00:00:00Z') },
      { id: 88, version: 1, department: '行政部', publishedAt: new Date('2026-04-01T00:00:00Z') },
    ]);
    mockPrisma.scheduleConfirmation.findUnique.mockResolvedValue({ version: 1, isValid: true });

    await expect(canEmployeeClockIn(7, new Date('2026-04-10T08:00:00.000Z'))).resolves.toEqual({ allowed: true });
    expect(mockPrisma.scheduleConfirmation.findUnique).toHaveBeenCalledWith({
      where: { employeeId_releaseId: { employeeId: 7, releaseId: 88 } },
    });
  });

  it('reminds only active employees who have schedules and writes to the in-app notification channel', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.enableReminder', value: 'true' }
    ]);
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([{
      id: 88,
      version: 1,
      department: '行政部',
      publishedAt: new Date('2026-04-01T00:00:00Z'),
      deadline: new Date('2026-04-30T15:59:59Z'),
    }]);
    mockPrisma.employee.findMany.mockResolvedValue([{ id: 7, name: '王小明' }]);

    const result = await sendReminderToUnconfirmed('2026-04', '行政部');

    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        department: '行政部',
        schedules: { some: { workDate: { startsWith: '2026-04-' } } },
      }),
    }));
    expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({
      channels: ['IN_APP'],
      targetUsers: ['7'],
      data: expect.objectContaining({ path: '/my-schedule' }),
    }));
    expect(result).toEqual({ sent: 1, pending: 1, errors: 0 });
  });

  it('always sends publication notice through the in-app channel when confirmation is enabled', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.enableReminder', value: 'false' }
    ]);

    await expect(sendSchedulePublishNotification(
      '2026-04',
      [7, 8],
      new Date('2026-04-30T15:59:59Z')
    )).resolves.toEqual({ sent: 2, errors: 0 });

    expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({
      channels: ['IN_APP'],
      targetUsers: ['7', '8'],
      data: expect.objectContaining({ path: '/my-schedule' }),
    }));
  });

  it('does not auto-create a release for scheduled months before checking clock-in confirmation', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.blockClock', value: 'true' }
    ]);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 7, department: '行政部' });
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null);
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 1001 });

    await expect(canEmployeeClockIn(7, new Date('2026-04-10T08:00:00.000Z'))).resolves.toEqual({
      allowed: false,
      reason: '本月班表尚未發布，請聯繫排班管理員'
    });
    expect(mockPrisma.scheduleMonthlyRelease.create).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleConfirmation.findUnique).not.toHaveBeenCalled();
  });

  it('blocks clock-in when the employee confirmation was invalidated without a release version bump', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.blockClock', value: 'true' }
    ]);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 7, department: '行政部' });
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 1001 });
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([{
      id: 88,
      version: 3,
      department: '行政部',
      publishedAt: new Date(),
    }]);
    mockPrisma.scheduleConfirmation.findUnique.mockResolvedValue({ version: 3, isValid: false });

    await expect(canEmployeeClockIn(7, new Date('2026-04-10T08:00:00.000Z'))).resolves.toEqual({
      allowed: false,
      reason: '班表已更新，請重新確認後再打卡'
    });
  });

  it('invalidates only the target employee confirmation without bumping the release version', async () => {
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([{ id: 88, department: '行政部', publishedAt: new Date(), version: 1 }]);
    mockPrisma.scheduleConfirmation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '王小明', department: '行政部' });

    const result = await invalidateConfirmation(7, '2025-09');

    expect(result).toEqual({
      invalidated: true,
      message: '已通知 王小明 重新確認班表'
    });
    expect(mockPrisma.scheduleMonthlyRelease.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleConfirmation.updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 7,
        yearMonth: '2025-09',
        releaseId: 88,
        isValid: true
      },
      data: {
        isValid: false
      }
    });
    expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({
      channels: ['IN_APP'],
      targetUsers: ['7'],
      data: expect.objectContaining({ path: '/my-schedule' }),
    }));
  });

  it('does nothing when the month has not been published', async () => {
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null);
    mockPrisma.schedule.findFirst.mockResolvedValue(null);

    await expect(invalidateConfirmation(7, '2025-09')).resolves.toEqual({
      invalidated: false,
      message: '尚無發布記錄'
    });
    expect(mockPrisma.scheduleConfirmation.updateMany).not.toHaveBeenCalled();
  });

  it('does not create a release while invalidating when scheduled data exists without a publish record', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 7, department: '行政部' });
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null);
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 2001 });

    const result = await invalidateConfirmation(7, '2025-10');

    expect(result).toEqual({
      invalidated: false,
      message: '尚無發布記錄'
    });
    expect(mockPrisma.scheduleMonthlyRelease.create).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleConfirmation.updateMany).not.toHaveBeenCalled();
  });
});
