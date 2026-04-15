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
      { employeeId: 100, workDate: '2026-04-10', startTime: '09:00', endTime: '18:00' },
      { employeeId: 101, workDate: '2026-04-09', startTime: '09:00', endTime: '18:00' }
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
});