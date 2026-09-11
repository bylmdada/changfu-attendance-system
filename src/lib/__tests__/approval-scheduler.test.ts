jest.mock('@/lib/database', () => ({
  prisma: {
    approvalFreezeReminder: { findFirst: jest.fn() },
  },
}));

jest.mock('@/lib/approval-notifications', () => ({
  notifyApplicant: jest.fn(),
  notifyBeforeFreeze: jest.fn(),
  notifyReviewers: jest.fn(),
}));

jest.mock('@/lib/attendance-freeze', () => ({
  getAttendanceFreezeSettings: jest.fn(),
}));

jest.mock('@/lib/attendance-freeze-rules', () => ({
  getNextAttendanceFreezeExecutionDate: jest.fn(),
}));

jest.mock('@/lib/approval-helper', () => ({
  updateRequestStatus: jest.fn(),
}));

jest.mock('@/lib/realtime-notifications', () => ({
  sendNotification: jest.fn(),
}));

import { prisma } from '@/lib/database';
import { notifyBeforeFreeze } from '@/lib/approval-notifications';
import { getAttendanceFreezeSettings } from '@/lib/attendance-freeze';
import { getNextAttendanceFreezeExecutionDate } from '@/lib/attendance-freeze-rules';
import { processOverdueApprovals } from '@/lib/approval-scheduler';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockNotifyBeforeFreeze = notifyBeforeFreeze as jest.MockedFunction<typeof notifyBeforeFreeze>;
const mockGetAttendanceFreezeSettings = getAttendanceFreezeSettings as jest.MockedFunction<typeof getAttendanceFreezeSettings>;
const mockGetNextFreeze = getNextAttendanceFreezeExecutionDate as jest.MockedFunction<typeof getNextAttendanceFreezeExecutionDate>;

describe('approval freeze reminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-02T01:00:00.000Z'));
    mockPrisma.approvalFreezeReminder.findFirst.mockResolvedValue({
      daysBeforeFreeze1: 3,
      daysBeforeFreeze2: 1,
      freezeDayReminderTime: '09:00',
    } as never);
    mockGetAttendanceFreezeSettings.mockResolvedValue({
      freezeDay: 5,
      freezeTime: '18:00',
      isEnabled: true,
      description: '',
    });
    mockGetNextFreeze.mockReturnValue(new Date('2026-07-05T10:00:00.000Z'));
    mockNotifyBeforeFreeze.mockResolvedValue({ success: true, sentCount: 2 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs the configured reminder on the Taiwan calendar day before freeze', async () => {
    const result = await processOverdueApprovals();

    expect(mockNotifyBeforeFreeze).toHaveBeenCalledWith(3, '2026-07-05-3');
    expect(result).toEqual(expect.objectContaining({
      skipped: true,
      freezeRemindersSent: 2,
    }));
  });
});
