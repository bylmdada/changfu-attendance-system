const mockPrisma = {
  systemSettings: {
    findMany: jest.fn()
  },
  scheduleMonthlyRelease: {
    findFirst: jest.fn(),
    update: jest.fn()
  },
  scheduleConfirmation: {
    findUnique: jest.fn(),
    updateMany: jest.fn()
  },
  employee: {
    findUnique: jest.fn()
  },
  notification: {
    create: jest.fn()
  }
};

jest.mock('@/lib/database', () => ({
  prisma: mockPrisma
}));

import { canEmployeeClockIn, invalidateConfirmation } from '@/lib/schedule-confirm-service';

describe('invalidateConfirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks clock-in when the active month has not been published yet', async () => {
    mockPrisma.systemSettings.findMany.mockResolvedValue([
      { key: 'scheduleConfirm.enabled', value: 'true' },
      { key: 'scheduleConfirm.blockClock', value: 'true' }
    ]);
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 7, department: '行政部' });
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null);

    await expect(canEmployeeClockIn(7, new Date('2026-04-10T08:00:00.000Z'))).resolves.toEqual({
      allowed: false,
      reason: '本月班表尚未發布，請聯繫排班管理員'
    });
    expect(mockPrisma.scheduleConfirmation.findUnique).not.toHaveBeenCalled();
  });

  it('invalidates only the target employee confirmation without bumping the release version', async () => {
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue({ id: 88 });
    mockPrisma.scheduleConfirmation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '王小明' });
    mockPrisma.notification.create.mockResolvedValue({ id: 1 });

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
  });

  it('does nothing when the month has not been published', async () => {
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null);

    await expect(invalidateConfirmation(7, '2025-09')).resolves.toEqual({
      invalidated: false,
      message: '尚無發布記錄'
    });
    expect(mockPrisma.scheduleConfirmation.updateMany).not.toHaveBeenCalled();
  });
});
