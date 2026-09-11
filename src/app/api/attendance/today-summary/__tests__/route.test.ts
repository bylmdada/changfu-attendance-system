import { NextRequest } from 'next/server';
import { GET } from '@/app/api/attendance/today-summary/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    attendanceRecord: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    overtimeRequest: {
      findMany: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
    },
    schedule: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('attendance today summary authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findFirst.mockResolvedValue(null as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
  });

  it('does not expose company attendance counts to users who only have a manager title', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 50,
      role: 'EMPLOYEE',
      username: 'line-manager',
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 5,
      role: 'EMPLOYEE',
      isActive: true,
      employee: {
        id: 50,
        employeeId: 'E050',
        name: 'Line Manager',
        department: '製造部',
        position: 'MANAGER',
      },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.attendanceCount).toBeUndefined();
    expect(mockPrisma.attendanceRecord.count).not.toHaveBeenCalled();
  });

  it('still returns company attendance counts for HR users', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 6,
      employeeId: 60,
      role: 'HR',
      username: 'hr-user',
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 6,
      role: 'HR',
      isActive: true,
      employee: {
        id: 60,
        employeeId: 'E060',
        name: 'HR User',
        department: '人資部',
        position: 'SPECIALIST',
      },
    } as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, index) => ({ employeeId: index + 1 })) as never
    );

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.attendanceCount).toBe(12);
    expect(payload.lateCount).toBe(0);
    expect(payload.absentCount).toBe(0);
    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clockInTime: { not: null },
          employee: { isActive: true },
        }),
        select: { employeeId: true },
      })
    );
  });

  it('uses Taiwan day boundaries for personal and company attendance queries', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-07T22:30:00.000Z'));

    mockGetUserFromRequest.mockResolvedValue({
      userId: 6,
      employeeId: 60,
      role: 'HR',
      username: 'hr-user',
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 6,
      role: 'HR',
      isActive: true,
      employee: {
        id: 60,
        employeeId: 'E060',
        name: 'HR User',
        department: '人資部',
        position: 'SPECIALIST',
      },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));

    expect(response.status).toBe(200);
    expect(mockPrisma.attendanceRecord.findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: 60,
        workDate: {
          gte: new Date('2026-04-07T16:00:00.000Z'),
          lt: new Date('2026-04-08T16:00:00.000Z'),
        },
      },
    });
    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenCalledWith({
      where: {
        workDate: {
          gte: new Date('2026-04-07T16:00:00.000Z'),
          lt: new Date('2026-04-08T16:00:00.000Z'),
        },
        clockInTime: { not: null },
        employee: {
          isActive: true,
        },
      },
      select: {
        employeeId: true,
      },
    });

    jest.useRealTimers();
  });

  it('calculates admin late and absent counts from today schedules and attendance records', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-07T05:55:00.000Z')); // 13:55 in Taiwan

    mockGetUserFromRequest.mockResolvedValue({
      userId: 6,
      employeeId: 60,
      role: 'ADMIN',
      username: 'admin-user',
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 6,
      role: 'ADMIN',
      isActive: true,
      employee: {
        id: 60,
        employeeId: 'E060',
        name: 'Admin User',
        department: '人資部',
        position: 'ADMIN',
      },
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { employeeId: 1, shiftType: 'B', startTime: '08:00', endTime: '17:00' },
      { employeeId: 2, shiftType: 'B', startTime: '08:00', endTime: '17:00' },
      { employeeId: 3, shiftType: 'B', startTime: '08:00', endTime: '17:00' },
      { employeeId: 4, shiftType: 'RD', startTime: '', endTime: '' },
    ] as never);
    const todayClockedInRecords = [
      {
        employeeId: 1,
        clockInTime: new Date('2026-05-07T00:01:00.000Z'), // 08:01 in Taiwan
        clockOutTime: null,
      },
      {
        employeeId: 3,
        clockInTime: new Date('2026-05-06T23:59:00.000Z'), // 07:59 in Taiwan
        clockOutTime: null,
      },
    ];
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce(todayClockedInRecords.map(record => ({ employeeId: record.employeeId })) as never)
      .mockResolvedValueOnce(todayClockedInRecords as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.attendanceCount).toBe(2);
    expect(payload.lateCount).toBe(1);
    expect(payload.absentCount).toBe(1);
    expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith({
      where: {
        workDate: '2026-05-07',
        employee: {
          isActive: true,
        },
      },
      select: {
        employeeId: true,
        shiftType: true,
        startTime: true,
        endTime: true,
      },
    });

    jest.useRealTimers();
  });

  it('shows only approved overtime hours in personal today summary', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-07T05:55:00.000Z'));

    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 70,
      role: 'EMPLOYEE',
      username: 'employee-user',
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      role: 'EMPLOYEE',
      isActive: true,
      employee: {
        id: 70,
        employeeId: 'E070',
        name: 'Employee User',
        department: '製造部',
        position: 'Staff',
      },
    } as never);
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 70,
      employeeId: 70,
      workDate: new Date('2026-05-06T16:00:00.000Z'),
      clockInTime: new Date('2026-05-07T01:00:00.000Z'),
      clockOutTime: new Date('2026-05-07T11:00:00.000Z'),
      clockInOvertimeId: null,
      clockOutOvertimeId: null,
      status: 'PRESENT',
      notes: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.workSummary.totalHours).toBe(10);
    expect(payload.data.workSummary.regularHours).toBe(8);
    expect(payload.data.workSummary.overtimeHours).toBe(0);
    expect(mockPrisma.overtimeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        employeeId: 70,
        status: 'APPROVED',
      }),
    }));

    jest.useRealTimers();
  });

  it('excludes a manager-agreed business trip from scheduled regular hours without creating overtime', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T07:30:00.000Z'));

    mockGetUserFromRequest.mockResolvedValue({
      userId: 35,
      employeeId: 35,
      role: 'EMPLOYEE',
      username: '2026990002',
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 35,
      role: 'EMPLOYEE',
      isActive: true,
      employee: {
        id: 35,
        employeeId: '2026990002',
        name: '測試乙',
        department: '測試部',
        position: 'Staff',
      },
    } as never);
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 914,
      employeeId: 35,
      workDate: new Date('2026-07-16T16:00:00.000Z'),
      clockInTime: new Date('2026-07-16T23:45:00.000Z'),
      clockOutTime: new Date('2026-07-17T05:10:00.000Z'),
      clockInOvertimeId: null,
      clockOutOvertimeId: null,
      status: 'EARLY_LEAVE',
      notes: null,
    } as never);
    mockPrisma.schedule.findFirst.mockResolvedValue({
      shiftType: 'B',
      startTime: '08:00',
      endTime: '17:00',
      breakTime: 60,
      workHours: 0,
    } as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([{
      startDate: new Date('2026-07-17T05:00:00.000Z'),
      endDate: new Date('2026-07-17T09:00:00.000Z'),
      status: 'PENDING_ADMIN',
      managerOpinion: 'AGREE',
      voidedAt: null,
    }] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.workSummary).toEqual({
      totalHours: 4.42,
      regularHours: 4,
      overtimeHours: 0,
    });

    jest.useRealTimers();
  });
});
