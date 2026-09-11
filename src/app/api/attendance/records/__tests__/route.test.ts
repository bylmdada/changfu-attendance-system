jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    attendanceRecord: {
      count: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn()
    },
    overtimeRequest: {
      findMany: jest.fn()
    },
    leaveRequest: {
      findMany: jest.fn()
    },
    schedule: {
      findMany: jest.fn()
    },
    departmentManager: {
      findMany: jest.fn()
    }
  }
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/database';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('attendance records route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 100,
      role: 'ADMIN',
      username: 'admin'
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.attendanceRecord.count.mockResolvedValue(0 as never);
    mockPrisma.attendanceRecord.updateMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.departmentManager.findMany.mockResolvedValue([] as never);
  });

  it('rejects malformed page parameters instead of coercing them with parseInt', async () => {
    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1abc'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('page 參數格式無效');
    expect(mockPrisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid startDate values before building the Prisma filter', async () => {
    const response = await GET(new NextRequest('http://localhost/api/attendance/records?startDate=not-a-date'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('startDate 參數格式無效');
    expect(mockPrisma.attendanceRecord.count).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid yearMonth values before querying attendance records', async () => {
    const response = await GET(new NextRequest('http://localhost/api/attendance/records?yearMonth=2026-13'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('yearMonth 參數格式無效');
    expect(mockPrisma.attendanceRecord.count).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid year values before querying attendance records', async () => {
    const response = await GET(new NextRequest('http://localhost/api/attendance/records?year=20A6'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('year 參數格式無效');
    expect(mockPrisma.attendanceRecord.count).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('applies year filters for admin attendance queries', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/attendance/records?page=1&pageSize=10&year=2026'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records).toEqual([]);

    const countArgs = mockPrisma.attendanceRecord.count.mock.calls[0]?.[0] as {
      where: {
        workDate?: { gte?: Date; lte?: Date };
      };
    };

    expect(countArgs.where.workDate?.gte?.toISOString()).toBe('2025-12-31T16:00:00.000Z');
    expect(countArgs.where.workDate?.lte?.toISOString()).toBe('2026-12-31T15:59:59.999Z');
  });

  it('applies exact employee and month filters for admin attendance queries', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/attendance/records?page=1&pageSize=10&yearMonth=2026-04&employeeId=E105&department=製造部'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records).toEqual([]);

    const countArgs = mockPrisma.attendanceRecord.count.mock.calls[0]?.[0] as {
      where: {
        employee?: unknown;
        workDate?: { gte?: Date; lte?: Date };
      };
    };

    expect(countArgs.where.employee).toEqual({
      AND: [
        { employeeId: 'E105' },
        { department: '製造部' },
      ],
    });
    expect(countArgs.where.workDate?.gte?.toISOString()).toBe('2026-03-31T16:00:00.000Z');
    expect(countArgs.where.workDate?.lte?.toISOString()).toBe('2026-04-30T15:59:59.999Z');
  });

  it('allows an active department manager to query attendance records from managed departments', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 35,
      employeeId: 35,
      role: 'USER',
      username: '2026990002'
    } as never);
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '溪北輔具中心' }
    ] as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);

    const response = await GET(
      new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.departmentManager.findMany).toHaveBeenCalledWith({
      where: { employeeId: 35, isActive: true },
      select: { department: true },
    });
    expect(mockPrisma.attendanceRecord.count).toHaveBeenCalledWith({
      where: {
        employee: { department: { in: ['溪北輔具中心'] } },
      },
    });
    expect(payload.scope).toEqual({
      canViewDepartmentRecords: true,
      managedDepartments: ['溪北輔具中心'],
    });
  });

  it('does not let a department manager escape managed departments through filters', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 35,
      employeeId: 35,
      role: 'USER',
      username: '2026990002'
    } as never);
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '溪北輔具中心' }
    ] as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/attendance/records?page=1&pageSize=10&department=溪南日照中心&employeeId=OUTSIDE001'
      )
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.attendanceRecord.count).toHaveBeenCalledWith({
      where: {
        employee: {
          AND: [
            { department: { in: ['溪北輔具中心'] } },
            { employeeId: 'OUTSIDE001' },
            { department: '溪南日照中心' },
          ],
        },
      },
    });
  });

  it('filters by computed display status before paginating so early-leave rows are not skipped', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 100,
        workDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T01:00:00.000Z'),
        clockOutTime: new Date('2026-04-10T10:00:00.000Z'),
        regularHours: 8,
        overtimeHours: 0,
        status: 'PRESENT',
        createdAt: new Date('2026-04-10T10:05:00.000Z'),
        clockInLatitude: null,
        clockInLongitude: null,
        clockInAccuracy: null,
        clockInAddress: null,
        clockOutLatitude: null,
        clockOutLongitude: null,
        clockOutAccuracy: null,
        clockOutAddress: null,
        employee: {
          id: 100,
          employeeId: 'E100',
          name: '正常員工',
          department: '製造部',
          position: 'Staff'
        }
      },
      {
        id: 2,
        employeeId: 101,
        workDate: new Date('2026-04-09T00:00:00.000Z'),
        clockInTime: new Date('2026-04-09T01:00:00.000Z'),
        clockOutTime: new Date('2026-04-09T05:00:00.000Z'),
        regularHours: 4,
        overtimeHours: 0,
        status: 'PRESENT',
        createdAt: new Date('2026-04-09T05:05:00.000Z'),
        clockInLatitude: null,
        clockInLongitude: null,
        clockInAccuracy: null,
        clockInAddress: null,
        clockOutLatitude: null,
        clockOutLongitude: null,
        clockOutAccuracy: null,
        clockOutAddress: null,
        employee: {
          id: 101,
          employeeId: 'E101',
          name: '異常員工',
          department: '製造部',
          position: 'Staff'
        }
      }
    ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      { employeeId: 100, workDate: '2026-04-10', startTime: '09:00', endTime: '18:00', breakTime: 0, workHours: 8 },
      { employeeId: 101, workDate: '2026-04-09', startTime: '09:00', endTime: '18:00', breakTime: 0, workHours: 8 }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=1&status=早退'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].id).toBe(2);
    expect(payload.records[0].status).toBe('早退');
    expect(payload.pagination.total).toBe(1);
    expect(payload.pagination.totalPages).toBe(1);
    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { displayStatus: { in: ['早退', '遲到+早退'] } },
              { displayStatus: null },
            ],
          },
        ],
      }),
    }));
    expect(mockPrisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { displayStatus: '正常' },
    });
    expect(mockPrisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [2] } },
      data: { displayStatus: '早退' },
    });
  });

  it('keeps exact late-and-early status results after materialized status prefiltering', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        id: 19,
        employeeId: 119,
        workDate: new Date('2026-04-24T00:00:00.000Z'),
        clockInTime: new Date('2026-04-24T01:30:00.000Z'),
        clockOutTime: new Date('2026-04-24T09:00:00.000Z'),
        regularHours: 7.5,
        overtimeHours: 0,
        status: 'PRESENT',
        createdAt: new Date('2026-04-24T17:05:00.000Z'),
        clockInLatitude: null,
        clockInLongitude: null,
        clockInAccuracy: null,
        clockInAddress: null,
        clockOutLatitude: null,
        clockOutLongitude: null,
        clockOutAccuracy: null,
        clockOutAddress: null,
        displayStatus: null,
        employee: {
          id: 119,
          employeeId: 'E119',
          name: '遲到早退員工',
          department: '製造部',
          position: 'Staff'
        }
      }
    ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      { employeeId: 119, workDate: '2026-04-24', startTime: '09:00', endTime: '18:00', breakTime: 0, workHours: 8 }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10&status=遲到%2B早退'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].status).toBe('遲到+早退');
    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          {
            OR: [
              { displayStatus: { in: ['遲到+早退'] } },
              { displayStatus: null },
            ],
          },
        ],
      }),
    }));
    expect(mockPrisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [19] } },
      data: { displayStatus: '遲到+早退' },
    });
  });

  it('uses the scheduled work hours when classifying no-time leave shift records', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 7,
          employeeId: 106,
          workDate: new Date('2026-04-11T00:00:00.000Z'),
          clockInTime: new Date('2026-04-11T09:00:00.000Z'),
          clockOutTime: new Date('2026-04-11T10:00:00.000Z'),
          regularHours: 1,
          overtimeHours: 0,
          status: 'PRESENT',
          createdAt: new Date('2026-04-11T10:05:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 106,
            employeeId: 'E106',
            name: '特休員工',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 106,
          workDate: new Date('2026-04-11T00:00:00.000Z'),
          clockInTime: new Date('2026-04-11T09:00:00.000Z'),
          clockOutTime: new Date('2026-04-11T10:00:00.000Z'),
          regularHours: 1,
          overtimeHours: 0,
        }
      ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 106,
        workDate: '2026-04-11',
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
        breakTime: 0,
        workHours: 0,
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].shiftType).toBe('FDL');
    expect(payload.records[0].status).toBe('正常');
  });

  it('recalculates regular and overtime hours from clock times so stale stored values do not leak to the records page', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 3,
          employeeId: 102,
          workDate: new Date('2026-04-07T16:00:00.000Z'),
          clockInTime: new Date('2026-04-08T01:00:00.000Z'),
          clockOutTime: new Date('2026-04-08T10:00:00.000Z'),
          regularHours: 9,
          overtimeHours: 0,
          status: 'PRESENT',
          createdAt: new Date('2026-04-08T18:05:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 102,
            employeeId: 'E102',
            name: '舊資料員工',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 102,
          workDate: new Date('2026-04-07T16:00:00.000Z'),
          clockInTime: new Date('2026-04-08T01:00:00.000Z'),
          clockOutTime: new Date('2026-04-08T10:00:00.000Z'),
          regularHours: 9,
          overtimeHours: 0,
        }
      ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 102,
        workDate: '2026-04-08',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
        workHours: 8,
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].regularHours).toBe(8);
    expect(payload.records[0].overtimeHours).toBe(0);
    expect(payload.summary.totalRegularHours).toBe(8);
    expect(payload.summary.totalOvertimeHours).toBe(0);
  });

  it('matches schedules by Taiwan work date so early personal time is excluded and break time is deducted', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 4,
          employeeId: 103,
          workDate: new Date('2026-04-16T16:00:00.000Z'),
          clockInTime: new Date('2026-04-17T00:02:00.000Z'),
          clockOutTime: new Date('2026-04-17T07:32:36.000Z'),
          regularHours: 7.51,
          overtimeHours: 0,
          status: 'PRESENT',
          createdAt: new Date('2026-04-17T07:35:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 103,
            employeeId: '0001',
            name: '測試丁',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 103,
          workDate: new Date('2026-04-16T16:00:00.000Z'),
          clockInTime: new Date('2026-04-17T00:02:00.000Z'),
          clockOutTime: new Date('2026-04-17T07:32:36.000Z'),
          regularHours: 7.51,
          overtimeHours: 0,
        }
      ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 103,
        workDate: '2026-04-17',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
        workHours: 8,
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].regularHours).toBe(5.53);
    expect(payload.records[0].overtimeHours).toBe(0);
    expect(payload.summary.totalRegularHours).toBe(5.53);
    expect(payload.summary.totalOvertimeHours).toBe(0);
  });

  it('includes early clock-in and late clock-out reasons for admin viewers', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 5,
          employeeId: 104,
          workDate: new Date('2026-04-18T00:00:00.000Z'),
          clockInTime: new Date('2026-04-18T08:30:00.000Z'),
          clockOutTime: new Date('2026-04-18T10:30:00.000Z'),
          clockInReason: 'BUSINESS',
          clockOutReason: 'BUSINESS',
          regularHours: 8,
          overtimeHours: 0.5,
          status: 'PRESENT',
          createdAt: new Date('2026-04-18T10:35:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 104,
            employeeId: 'E104',
            name: '可看原因員工',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 104,
          workDate: new Date('2026-04-18T00:00:00.000Z'),
          clockInTime: new Date('2026-04-18T08:30:00.000Z'),
          clockOutTime: new Date('2026-04-18T10:30:00.000Z'),
          regularHours: 8,
          overtimeHours: 0.5,
        }
      ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 104,
        workDate: '2026-04-18',
        shiftType: '早班',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
        workHours: 8,
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].clockInReason).toBe('公務');
    expect(payload.records[0].clockOutReason).toBe('公務');
    expect(payload.records[0].shiftType).toBe('早班');
    expect(payload.records[0].scheduledStart).toBe('09:00');
  });

  it('only shows approved overtime hours on the attendance records page', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 6,
          employeeId: 105,
          workDate: new Date('2026-04-19T00:00:00.000Z'),
          clockInTime: new Date('2026-04-19T09:00:00.000Z'),
          clockOutTime: new Date('2026-04-19T19:00:00.000Z'),
          regularHours: 8,
          overtimeHours: 2,
          status: 'PRESENT',
          createdAt: new Date('2026-04-19T19:05:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 105,
            employeeId: 'E105',
            name: '未核准加班員工',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 105,
          workDate: new Date('2026-04-19T00:00:00.000Z'),
          clockInTime: new Date('2026-04-19T09:00:00.000Z'),
          clockOutTime: new Date('2026-04-19T19:00:00.000Z'),
          regularHours: 8,
          overtimeHours: 2,
          clockInOvertimeId: null,
          clockOutOvertimeId: null,
        }
      ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 105,
        workDate: '2026-04-19',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
        workHours: 8,
      }
    ] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].overtimeHours).toBe(0);
    expect(payload.summary.totalOvertimeHours).toBe(0);
  });

  it('excludes a manager-agreed public trip interval from scheduled regular hours', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    const record = {
      id: 20,
      employeeId: 120,
      workDate: new Date('2026-07-16T16:00:00.000Z'),
      clockInTime: new Date('2026-07-16T23:45:00.000Z'),
      clockOutTime: new Date('2026-07-17T05:10:00.000Z'),
      regularHours: 0,
      overtimeHours: 4.17,
      status: 'PRESENT',
      createdAt: new Date('2026-07-17T05:10:00.000Z'),
      clockInLatitude: null,
      clockInLongitude: null,
      clockInAccuracy: null,
      clockInAddress: null,
      clockOutLatitude: null,
      clockOutLongitude: null,
      clockOutAccuracy: null,
      clockOutAddress: null,
      clockInOvertimeId: null,
      clockOutOvertimeId: null,
      employee: {
        id: 120,
        employeeId: '2026990002',
        name: '測試乙',
        department: '製造部',
        position: 'Staff',
      },
    };
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([record] as never)
      .mockResolvedValueOnce([{
        id: record.id,
        employeeId: record.employeeId,
        workDate: record.workDate,
        clockInTime: record.clockInTime,
        clockOutTime: record.clockOutTime,
        regularHours: record.regularHours,
        overtimeHours: record.overtimeHours,
        clockInOvertimeId: null,
        clockOutOvertimeId: null,
        displayStatus: null,
      }] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 120,
        workDate: '2026-07-17',
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 60,
        workHours: 0,
      },
    ] as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([
      {
        employeeId: 120,
        startDate: new Date('2026-07-17T05:00:00.000Z'),
        endDate: new Date('2026-07-17T09:00:00.000Z'),
        status: 'PENDING_ADMIN',
        managerOpinion: 'AGREE',
        voidedAt: null,
      },
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].regularHours).toBe(4);
    expect(payload.records[0].overtimeHours).toBe(0);
    expect(payload.summary.totalRegularHours).toBe(4);
    expect(payload.summary.totalOvertimeHours).toBe(0);
  });

  it('returns status breakdown counts in the summary payload', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(2 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 9,
          employeeId: 108,
          workDate: new Date('2026-04-21T00:00:00.000Z'),
          clockInTime: new Date('2026-04-21T01:00:00.000Z'),
          clockOutTime: new Date('2026-04-21T10:00:00.000Z'),
          regularHours: 8,
          overtimeHours: 0,
          status: 'PRESENT',
          createdAt: new Date('2026-04-21T18:05:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 108,
            employeeId: 'E108',
            name: '正常員工',
            department: '製造部',
            position: 'Staff'
          }
        },
        {
          id: 10,
          employeeId: 109,
          workDate: new Date('2026-04-22T00:00:00.000Z'),
          clockInTime: new Date('2026-04-22T09:30:00.000Z'),
          clockOutTime: new Date('2026-04-22T17:30:00.000Z'),
          regularHours: 8,
          overtimeHours: 0,
          status: 'PRESENT',
          createdAt: new Date('2026-04-22T17:35:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 109,
            employeeId: 'E109',
            name: '遲到早退員工',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 108,
          workDate: new Date('2026-04-21T00:00:00.000Z'),
          clockInTime: new Date('2026-04-21T01:00:00.000Z'),
          clockOutTime: new Date('2026-04-21T10:00:00.000Z'),
          regularHours: 8,
          overtimeHours: 0,
          clockInOvertimeId: null,
          clockOutOvertimeId: null,
        },
        {
          employeeId: 109,
          workDate: new Date('2026-04-22T00:00:00.000Z'),
          clockInTime: new Date('2026-04-22T09:30:00.000Z'),
          clockOutTime: new Date('2026-04-22T17:30:00.000Z'),
          regularHours: 8,
          overtimeHours: 0,
          clockInOvertimeId: null,
          clockOutOvertimeId: null,
        }
      ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 108,
        workDate: '2026-04-21',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 0,
        workHours: 8,
      },
      {
        employeeId: 109,
        workDate: '2026-04-22',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 0,
        workHours: 8,
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary.statusBreakdown).toEqual({
      正常: 1,
      '遲到': 1,
    });
  });

  it('filters overtime=0 using approved overtime validity instead of raw stored overtime', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        id: 8,
        employeeId: 107,
        workDate: new Date('2026-04-20T00:00:00.000Z'),
        clockInTime: new Date('2026-04-20T09:00:00.000Z'),
        clockOutTime: new Date('2026-04-20T19:00:00.000Z'),
        regularHours: 8,
        overtimeHours: 2,
        status: 'PRESENT',
        createdAt: new Date('2026-04-20T19:05:00.000Z'),
        clockInLatitude: null,
        clockInLongitude: null,
        clockInAccuracy: null,
        clockInAddress: null,
        clockOutLatitude: null,
        clockOutLongitude: null,
        clockOutAccuracy: null,
        clockOutAddress: null,
        employee: {
          id: 107,
          employeeId: 'E107',
          name: '無效加班員工',
          department: '製造部',
          position: 'Staff'
        }
      }
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 107,
        workDate: '2026-04-20',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
        workHours: 8,
      }
    ] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10&overtimeHours=0'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].overtimeHours).toBe(0);
    expect(payload.pagination.total).toBe(1);
  });

  it('marks cross-midnight night shift clock-in as late', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 11,
          employeeId: 110,
          workDate: new Date('2026-04-21T16:00:00.000Z'),
          clockInTime: new Date('2026-04-22T16:30:00.000Z'),
          clockOutTime: new Date('2026-04-22T22:00:00.000Z'),
          regularHours: 8,
          overtimeHours: 0,
          status: 'PRESENT',
          createdAt: new Date('2026-04-22T22:05:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 110,
            employeeId: 'E110',
            name: '夜班員工',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 110,
          workDate: new Date('2026-04-21T16:00:00.000Z'),
          clockInTime: new Date('2026-04-22T16:30:00.000Z'),
          clockOutTime: new Date('2026-04-22T22:00:00.000Z'),
          regularHours: 8,
          overtimeHours: 0,
          clockInOvertimeId: null,
          clockOutOvertimeId: null,
        }
      ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 110,
        workDate: '2026-04-22',
        shiftType: 'N',
        startTime: '22:00',
        endTime: '06:00',
        breakTime: 0,
        workHours: 8,
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].status).toBe('遲到');
  });

  it('shows short unscheduled attendance as neutral instead of abnormal', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 12,
          employeeId: 111,
          workDate: new Date('2026-04-23T00:00:00.000Z'),
          clockInTime: new Date('2026-04-23T01:00:00.000Z'),
          clockOutTime: new Date('2026-04-23T04:00:00.000Z'),
          regularHours: 3,
          overtimeHours: 0,
          status: 'PRESENT',
          createdAt: new Date('2026-04-23T04:05:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 111,
            employeeId: 'E111',
            name: '假日支援員工',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 111,
          workDate: new Date('2026-04-23T00:00:00.000Z'),
          clockInTime: new Date('2026-04-23T01:00:00.000Z'),
          clockOutTime: new Date('2026-04-23T04:00:00.000Z'),
          regularHours: 3,
          overtimeHours: 0,
          clockInOvertimeId: null,
          clockOutOvertimeId: null,
        }
      ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].status).toBe('無班表出勤');
    expect(payload.summary.statusBreakdown).toEqual({ 無班表出勤: 1 });
  });

  it('marks duplicate Taiwan work-date records for the same employee', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(2 as never);
    const duplicatedRecords = [
      {
        id: 13,
        employeeId: 112,
        workDate: new Date('2026-04-23T16:00:00.000Z'),
        clockInTime: new Date('2026-04-24T01:00:00.000Z'),
        clockOutTime: new Date('2026-04-24T05:00:00.000Z'),
        regularHours: 4,
        overtimeHours: 0,
        status: 'PRESENT',
        createdAt: new Date('2026-04-24T05:05:00.000Z'),
        clockInLatitude: null,
        clockInLongitude: null,
        clockInAccuracy: null,
        clockInAddress: null,
        clockOutLatitude: null,
        clockOutLongitude: null,
        clockOutAccuracy: null,
        clockOutAddress: null,
        employee: {
          id: 112,
          employeeId: 'E112',
          name: '重複員工',
          department: '製造部',
          position: 'Staff'
        }
      },
      {
        id: 14,
        employeeId: 112,
        workDate: new Date('2026-04-24T00:00:00.000Z'),
        clockInTime: new Date('2026-04-24T06:00:00.000Z'),
        clockOutTime: new Date('2026-04-24T09:00:00.000Z'),
        regularHours: 3,
        overtimeHours: 0,
        status: 'PRESENT',
        createdAt: new Date('2026-04-24T09:05:00.000Z'),
        clockInLatitude: null,
        clockInLongitude: null,
        clockInAccuracy: null,
        clockInAddress: null,
        clockOutLatitude: null,
        clockOutLongitude: null,
        clockOutAccuracy: null,
        clockOutAddress: null,
        employee: {
          id: 112,
          employeeId: 'E112',
          name: '重複員工',
          department: '製造部',
          position: 'Staff'
        }
      }
    ];
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce(duplicatedRecords as never)
      .mockResolvedValueOnce(duplicatedRecords.map(record => ({
        id: record.id,
        employeeId: record.employeeId,
        workDate: record.workDate,
        clockInTime: record.clockInTime,
        clockOutTime: record.clockOutTime,
        regularHours: record.regularHours,
        overtimeHours: record.overtimeHours,
        clockInOvertimeId: null,
        clockOutOvertimeId: null,
        displayStatus: null,
      })) as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(2);
    expect(payload.records[0].duplicated).toBe(true);
    expect(payload.records[1].duplicated).toBe(true);
  });

  it('does not expose clock reasons to non-admin viewers', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 2,
      employeeId: 105,
      role: 'EMPLOYEE',
      username: 'employee',
    } as never);
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 6,
          employeeId: 105,
          workDate: new Date('2026-04-18T00:00:00.000Z'),
          clockInTime: new Date('2026-04-18T08:30:00.000Z'),
          clockOutTime: new Date('2026-04-18T10:30:00.000Z'),
          clockInReason: 'PERSONAL',
          clockOutReason: 'BUSINESS',
          regularHours: 8,
          overtimeHours: 0.5,
          status: 'PRESENT',
          createdAt: new Date('2026-04-18T10:35:00.000Z'),
          clockInLatitude: null,
          clockInLongitude: null,
          clockInAccuracy: null,
          clockInAddress: null,
          clockOutLatitude: null,
          clockOutLongitude: null,
          clockOutAccuracy: null,
          clockOutAddress: null,
          employee: {
            id: 105,
            employeeId: 'E105',
            name: '不可看原因員工',
            department: '製造部',
            position: 'Staff'
          }
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          employeeId: 105,
          workDate: new Date('2026-04-18T00:00:00.000Z'),
          clockInTime: new Date('2026-04-18T08:30:00.000Z'),
          clockOutTime: new Date('2026-04-18T10:30:00.000Z'),
          regularHours: 8,
          overtimeHours: 0.5,
        }
      ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0]).not.toHaveProperty('clockInReason');
    expect(payload.records[0]).not.toHaveProperty('clockOutReason');
  });
});
