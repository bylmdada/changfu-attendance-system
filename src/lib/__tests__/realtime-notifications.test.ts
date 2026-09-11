jest.mock('@/lib/database', () => ({
  prisma: {
    inAppNotification: {
      create: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/database';
import { sendNotification } from '@/lib/realtime-notifications';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('realtime notifications persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.inAppNotification.create.mockResolvedValue({ id: 1 } as never);
  });

  it('persists IN_APP channel notifications so the notification bell can read them', async () => {
    await sendNotification({
      type: 'APPROVAL',
      priority: 'NORMAL',
      channels: ['WEB', 'IN_APP'],
      title: '新審核項目',
      message: '王小明的請假申請需要您審核',
      data: {
        instanceId: 10,
        requestType: 'LEAVE',
        requestId: 20,
      },
      targetUsers: ['12'],
      createdBy: 'SYSTEM',
    });

    expect(mockPrisma.inAppNotification.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.inAppNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 12,
        type: 'APPROVAL',
        title: '新審核項目',
        message: '王小明的請假申請需要您審核',
        data: JSON.stringify({
          instanceId: 10,
          requestType: 'LEAVE',
          requestId: 20,
        }),
        isRead: false,
      }),
    });
  });
});
