import { NextRequest } from 'next/server';
import { GET } from '@/app/api/dashboard-stats/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';
import { calculateOvertimeRequestsEligibility } from '@/lib/overtime-eligibility';

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
    schedule: {
      findMany: jest.fn(),
    },
    overtimeRequest: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
}));

jest.mock('@/lib/overtime-eligibility', () => ({
  calculateOvertimeRequestsEligibility: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockCalculateEligibility = calculateOvertimeRequestsEligibility as jest.MockedFunction<
  typeof calculateOvertimeRequestsEligibility
>;

const shift = (employeeId: number, workDate: string, shiftType = 'A') => ({
  employeeId,
  workDate,
  shiftType,
  startTime: shiftType === 'OFF' ? '' : '09:00',
  endTime: shiftType === 'OFF' ? '' : '18:00',
  breakTime: 0,
  workHours: 9,
});

// 台北某日 00:00 對應的 workDate（UTC 前一天 16:00）
const workDateOf = (taipeiDate: string) => {
  const [year, month, day] = taipeiDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
};

const clockedIn = (employeeId: number, taipeiDate: string) => ({
  employeeId,
  workDate: workDateOf(taipeiDate),
  clockInTime: new Date(workDateOf(taipeiDate).getTime() + 60 * 60 * 1000),
});

const request = (query: string) => new NextRequest(`http://localhost/api/dashboard-stats?${query}`);

describe('dashboard stats supervisor scope guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'SUPERVISOR',
      employeeId: 20,
      userId: 2,
      username: 'supervisor',
    } as never);
    mockGetManageableDepartments.mockResolvedValue(['製造部'] as never);

    mockPrisma.employee.findMany.mockResolvedValue([{ id: 1, department: '製造部' }] as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.overtimeRequest.count.mockResolvedValue(0 as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.leaveRequest.count.mockResolvedValue(0 as never);
    mockCalculateEligibility.mockResolvedValue({
      byRequestId: new Map(),
      byEmployeeDate: new Map(),
      totalEffectiveHours: 0,
    } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/dashboard-stats'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
  });

  it('rejects a month that is not a real calendar month', async () => {
    const response = await GET(request('year=2026&month=13'));
    expect(response.status).toBe(400);

    const nonNumeric = await GET(request('year=2026&month=abc'));
    expect(nonNumeric.status).toBe(400);
  });

  it('limits supervisor dashboard statistics to manageable departments', async () => {
    const response = await GET(new NextRequest('http://localhost/api/dashboard-stats?year=2026&month=3', {
      headers: {
        cookie: 'auth-token=shared-session-token',
      },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        department: { in: ['製造部'] },
      },
      select: { id: true, department: true },
    });
    for (const model of [mockPrisma.attendanceRecord, mockPrisma.schedule]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employee: {
              department: { in: ['製造部'] },
            },
          }),
        })
      );
    }
  });

  it('counts today clocked-in employees by Taiwan date range and unique employee', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T04:30:00.000Z')); // 12:30 in Taiwan
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 1,
      username: 'admin',
    } as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      { id: 1, department: '製造部' },
      { id: 2, department: '製造部' },
      { id: 3, department: '製造部' },
    ] as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { employeeId: 1, clockInTime: new Date('2026-07-01T00:00:00.000Z'), clockOutTime: null },
        { employeeId: 1, clockInTime: new Date('2026-07-01T01:00:00.000Z'), clockOutTime: null },
        { employeeId: 2, clockInTime: new Date('2026-07-01T00:05:00.000Z'), clockOutTime: new Date('2026-07-01T09:00:00.000Z') },
        { employeeId: 3, clockInTime: null, clockOutTime: null },
      ] as never);

    const response = await GET(request('year=2026&month=7'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.today).toMatchObject({
      date: '2026-07-01',
      clockedIn: 2,
      clockedOut: 1,
      notClockedIn: 1,
    });
    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          workDate: {
            gte: new Date('2026-06-30T16:00:00.000Z'),
            lt: new Date('2026-07-01T16:00:00.000Z'),
          },
        },
      })
    );
  });

  describe('attendance rate uses scheduled shift days', () => {
    beforeEach(() => {
      mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1, userId: 1, username: 'admin' } as never);
    });

    it('rates an employee who only works two Saturdays at 100% in the total, the department and the trend', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-05T04:00:00.000Z'));
      mockPrisma.schedule.findMany.mockResolvedValue([shift(1, '2026-07-04'), shift(1, '2026-07-11')] as never);
      mockPrisma.attendanceRecord.findMany
        .mockResolvedValueOnce([clockedIn(1, '2026-07-04'), clockedIn(1, '2026-07-11')] as never)
        .mockResolvedValueOnce([] as never);

      const payload = await (await GET(request('year=2026&month=7'))).json();

      expect(payload.data.summary).toMatchObject({ attendanceRate: 100, expectedShifts: 2, attendedShifts: 2 });
      expect(payload.data.departments).toEqual([{ department: '製造部', total: 1, attended: 2, rate: 100 }]);
      expect(payload.data.trends.dailyAttendance).toEqual([
        { date: '2026-07-04', count: 1, total: 1 },
        { date: '2026-07-11', count: 1, total: 1 },
      ]);
      expect(payload.data.period.workDays).toBe(2);
    });

    it('only counts scheduled shifts up to the stats date for a month in progress', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-06T04:00:00.000Z')); // 7/6 12:00 in Taiwan
      mockPrisma.schedule.findMany.mockResolvedValue([shift(1, '2026-07-04'), shift(1, '2026-07-11')] as never);
      mockPrisma.attendanceRecord.findMany
        .mockResolvedValueOnce([clockedIn(1, '2026-07-04')] as never)
        .mockResolvedValueOnce([] as never);

      const payload = await (await GET(request('year=2026&month=7'))).json();

      expect(payload.data.summary).toMatchObject({ attendanceRate: 100, expectedShifts: 1, attendedShifts: 1 });
      expect(payload.data.trends.dailyAttendance).toEqual([{ date: '2026-07-04', count: 1, total: 1 }]);
    });

    it('has no expected shifts for a month that has not started', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-15T04:00:00.000Z'));
      mockPrisma.schedule.findMany.mockResolvedValue([shift(1, '2026-07-04')] as never);

      const payload = await (await GET(request('year=2026&month=7'))).json();

      expect(payload.data.summary).toMatchObject({ attendanceRate: 0, expectedShifts: 0, attendedShifts: 0 });
      expect(payload.data.trends.dailyAttendance).toEqual([]);
    });

    it('falls back to Monday-Friday only for employees with no schedule at all, and ignores clock-ins outside the expected days', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-05T04:00:00.000Z'));
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 1, department: '製造部' }, // 沒有班表 → 週一至週五（2026/7 有 23 天）
        { id: 2, department: '製造部' }, // 班表全是休假日 → 沒有應到班次
      ] as never);
      mockPrisma.schedule.findMany.mockResolvedValue([shift(2, '2026-07-01', 'OFF'), shift(2, '2026-07-02', 'OFF')] as never);
      mockPrisma.attendanceRecord.findMany
        .mockResolvedValueOnce([
          clockedIn(1, '2026-07-01'), // 週三，月初第一天要記成 7/1
          clockedIn(1, '2026-07-04'), // 週六不在應到班日內，不能灌進分子
          clockedIn(2, '2026-07-01'), // 休假日打卡也不算
        ] as never)
        .mockResolvedValueOnce([] as never);

      const payload = await (await GET(request('year=2026&month=7'))).json();

      expect(payload.data.summary).toMatchObject({ expectedShifts: 23, attendedShifts: 1, attendanceRate: 4.3 });
      expect(payload.data.departments).toEqual([{ department: '製造部', total: 2, attended: 1, rate: 4 }]);
      expect(payload.data.trends.dailyAttendance[0]).toEqual({ date: '2026-07-01', count: 1, total: 1 });
      expect(payload.data.trends.dailyAttendance).toHaveLength(23);
    });
  });

  it('queries every month table with Taipei month boundaries', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-05T04:00:00.000Z'));

    await GET(request('year=2026&month=7'));

    const monthStart = new Date('2026-06-30T16:00:00.000Z');
    const nextMonthStart = new Date('2026-07-31T16:00:00.000Z');
    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ workDate: { gte: monthStart, lt: nextMonthStart } }) })
    );
    expect(mockPrisma.overtimeRequest.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ overtimeDate: { gte: monthStart, lt: nextMonthStart }, status: 'APPROVED' }),
    });
    expect(mockPrisma.leaveRequest.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        startDate: { lt: nextMonthStart },
        endDate: { gt: monthStart },
        status: 'APPROVED',
      }),
    });
    expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workDate: { gte: '2026-07-01', lte: '2026-07-31' } }) })
    );
  });

  it('rolls December over to the next January start', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2027-01-05T04:00:00.000Z'));

    await GET(request('year=2026&month=12'));

    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          workDate: { gte: new Date('2026-11-30T16:00:00.000Z'), lt: new Date('2026-12-31T16:00:00.000Z') },
        }),
      })
    );
  });

  it('counts both first-stage and admin-stage requests as pending approvals', async () => {
    mockPrisma.leaveRequest.count.mockResolvedValue(1 as never);
    mockPrisma.overtimeRequest.count.mockResolvedValue(1 as never);

    const payload = await (await GET(request('year=2026&month=3'))).json();

    expect(payload.data.summary.pendingApprovals).toBe(2);
    expect(payload.data.leave.pending).toBe(1);
    const pendingWhere = expect.objectContaining({
      status: { in: ['PENDING', 'PENDING_ADMIN'] },
      employee: { department: { in: ['製造部'] } },
    });
    expect(mockPrisma.leaveRequest.count).toHaveBeenCalledWith({ where: pendingWhere });
    expect(mockPrisma.overtimeRequest.count).toHaveBeenCalledWith({ where: pendingWhere });
  });

  it('reports clock-recognised overtime separately from approved request hours', async () => {
    const approved = [{
      id: 10,
      employeeId: 20,
      overtimeDate: new Date('2026-03-05T00:00:00.000Z'),
      totalHours: 2,
    }];
    mockPrisma.overtimeRequest.findMany.mockResolvedValue(approved as never);
    mockCalculateEligibility.mockResolvedValue({
      byRequestId: new Map(),
      byEmployeeDate: new Map(),
      totalEffectiveHours: 0.19,
    } as never);

    const response = await GET(request('year=2026&month=3'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockCalculateEligibility).toHaveBeenCalledWith(approved);
    expect(payload.data.overtime.totalHours).toBe(0.19);
    expect(payload.data.overtime.approvedHours).toBe(2);
    expect(payload.data.overtime.requestCount).toBe(1);
  });

  it('splits a cross-month leave into one request and 4 hours in each month', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-05T04:00:00.000Z'));
    // 台北 7/31 14:00 ～ 8/1 13:00，各天班表 09:00–18:00 無休息
    const leave = {
      id: 1,
      employeeId: 1,
      leaveType: 'PERSONAL',
      startDate: new Date('2026-07-31T06:00:00.000Z'),
      endDate: new Date('2026-08-01T05:00:00.000Z'),
      status: 'APPROVED',
    };
    mockPrisma.leaveRequest.findMany.mockResolvedValue([leave] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([shift(1, '2026-07-31')] as never);
    const july = await (await GET(request('year=2026&month=7'))).json();

    mockPrisma.schedule.findMany.mockResolvedValue([shift(1, '2026-08-01')] as never);
    const august = await (await GET(request('year=2026&month=8'))).json();

    expect(july.data.leave.byType).toEqual({ PERSONAL: 1 });
    expect(july.data.leave.hoursByType).toEqual({ PERSONAL: 4 });
    expect(august.data.leave.byType).toEqual({ PERSONAL: 1 });
    expect(august.data.leave.hoursByType).toEqual({ PERSONAL: 4 });
  });
});
