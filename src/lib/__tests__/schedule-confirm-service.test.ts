const mockPrisma = {
  systemSettings: {
    findMany: jest.fn()
  },
  scheduleMonthlyRelease: {
    findFirst: jest.fn(),
    update: jest.fn()
  },
  scheduleConfirmation: {
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

import { invalidateConfirmation } from '@/lib/schedule-confirm-service';

describe('invalidateConfirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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