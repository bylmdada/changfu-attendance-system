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
      findMany: jest.fn()
    },
    schedule: {
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
    mockPrisma.attendanceRecord.count.mockResolvedValue(0 as never);
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

  it('filters by computed display status before paginating so abnormal rows are not skipped', async () => {
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
      { employeeId: 100, workDate: '2026-04-10', startTime: '09:00', endTime: '18:00', breakTime: 0 },
      { employeeId: 101, workDate: '2026-04-09', startTime: '09:00', endTime: '18:00', breakTime: 0 }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=1&status=異常'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].id).toBe(2);
    expect(payload.records[0].status).toBe('異常');
    expect(payload.pagination.total).toBe(1);
    expect(payload.pagination.totalPages).toBe(1);
  });

  it('recalculates regular and overtime hours from clock times so stale stored values do not leak to the records page', async () => {
    mockPrisma.attendanceRecord.count.mockResolvedValue(1 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 3,
          employeeId: 102,
          workDate: new Date('2026-04-08T00:00:00.000Z'),
          clockInTime: new Date('2026-04-08T09:00:00.000Z'),
          clockOutTime: new Date('2026-04-08T18:00:00.000Z'),
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
          workDate: new Date('2026-04-08T00:00:00.000Z'),
          clockInTime: new Date('2026-04-08T09:00:00.000Z'),
          clockOutTime: new Date('2026-04-08T18:00:00.000Z'),
          regularHours: 9,
          overtimeHours: 0,
        }
      ] as never);

    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 102,
        workDate: new Date('2026-04-08T00:00:00.000Z'),
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
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

  it('matches schedules by Taiwan work date so break time is deducted even when the stored UTC date lands on the previous day', async () => {
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
            name: '李明峰',
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
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].regularHours).toBe(6.51);
    expect(payload.records[0].overtimeHours).toBe(0);
    expect(payload.summary.totalRegularHours).toBe(6.51);
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
          clockOutReason: 'code review、修正、收尾',
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
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/records?page=1&pageSize=10'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].clockInReason).toBe('公務');
    expect(payload.records[0].clockOutReason).toBe('code review、修正、收尾');
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
          clockOutReason: 'code review、修正、收尾',
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
