jest.mock('@/lib/database', () => ({
  prisma: {
    attendanceFreeze: {
      findFirst: jest.fn(),
    },
    systemSettings: {
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/database';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('attendance freeze rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('freezes the target month from recurring settings after the Taiwan cutoff time', async () => {
    jest.setSystemTime(new Date('2026-04-05T10:30:00.000Z'));
    mockPrisma.attendanceFreeze.findFirst.mockResolvedValue(null as never);
    mockPrisma.systemSettings.findFirst.mockResolvedValue({
      key: 'attendance_freeze',
      value: JSON.stringify({
        freezeDay: 5,
        freezeTime: '18:00',
        isEnabled: true,
        description: '每月固定凍結'
      })
    } as never);

    const result = await checkAttendanceFreeze(new Date('2026-03-15T04:00:00.000Z'));

    expect(result).toEqual({
      isFrozen: true,
      freezeInfo: {
        freezeDate: new Date('2026-04-05T10:00:00.000Z'),
        description: '每月固定凍結',
        creator: {
          name: '系統設定'
        }
      }
    });
  });

  it('does not freeze before the recurring Taiwan cutoff time arrives', async () => {
    jest.setSystemTime(new Date('2026-04-05T09:59:00.000Z'));
    mockPrisma.attendanceFreeze.findFirst.mockResolvedValue(null as never);
    mockPrisma.systemSettings.findFirst.mockResolvedValue({
      key: 'attendance_freeze',
      value: JSON.stringify({
        freezeDay: 5,
        freezeTime: '18:00',
        isEnabled: true,
        description: '每月固定凍結'
      })
    } as never);

    const result = await checkAttendanceFreeze(new Date('2026-03-15T04:00:00.000Z'));

    expect(result).toEqual({ isFrozen: false });
  });

  it('uses Taiwan month boundaries when querying explicit freeze records', async () => {
    jest.setSystemTime(new Date('2026-04-01T01:00:00.000Z'));
    mockPrisma.attendanceFreeze.findFirst.mockResolvedValue(null as never);
    mockPrisma.systemSettings.findFirst.mockResolvedValue({
      key: 'attendance_freeze',
      value: JSON.stringify({
        freezeDay: 5,
        freezeTime: '18:00',
        isEnabled: true,
        description: '每月固定凍結'
      })
    } as never);

    await checkAttendanceFreeze(new Date('2026-03-31T16:30:00.000Z'));

    expect(mockPrisma.attendanceFreeze.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        targetMonth: 4,
        targetYear: 2026,
      }),
    }));
  });

  it('rethrows database errors instead of silently treating the month as unfrozen', async () => {
    const dbError = new Error('database unavailable');
    mockPrisma.attendanceFreeze.findFirst.mockRejectedValue(dbError as never);

    await expect(checkAttendanceFreeze(new Date('2026-03-15T04:00:00.000Z'))).rejects.toThrow('database unavailable');
  });
});
