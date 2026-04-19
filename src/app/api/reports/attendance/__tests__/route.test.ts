import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
    },
    overtimeRequest: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;

describe('attendance report route auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    });

    mockedGetUserFromToken.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    });
    mockedGetManageableDepartments.mockResolvedValue([] as never);

    mockedPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'EMP001',
        name: '王小明',
        department: 'HR',
        position: '專員',
        isActive: true,
      },
    ] as never);

    mockedPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate: new Date('2026-03-03T00:00:00.000Z'),
        clockInTime: new Date('2026-03-03T09:00:00.000Z'),
        clockOutTime: new Date('2026-03-03T18:00:00.000Z'),
        status: 'NORMAL',
        notes: null,
        employee: {
          id: 1,
          employeeId: 'EMP001',
          name: '王小明',
          department: 'HR',
          position: '專員',
        },
      },
    ] as never);

    mockedPrisma.leaveRequest.findMany.mockResolvedValue([] as never);
    mockedPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost/api/reports/attendance?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.report.summary.totalEmployees).toBe(1);
  });

  it('scopes supervisor requests to manageable departments', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 2,
      employeeId: 20,
      username: 'supervisor',
      role: 'SUPERVISOR',
      sessionId: 'session-2',
    } as never);
    mockedGetManageableDepartments.mockResolvedValue(['製造部'] as never);

    const request = new NextRequest('http://localhost/api/reports/attendance?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockedPrisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          department: { in: ['製造部'] },
        }),
      })
    );
  });

  it('counts 10:00 Taiwan clock-in as late', async () => {
    mockedPrisma.attendanceRecord.findMany.mockResolvedValueOnce([
      {
        employeeId: 1,
        workDate: new Date('2026-03-03T00:00:00.000Z'),
        clockInTime: new Date('2026-03-03T02:00:00.000Z'),
        clockOutTime: new Date('2026-03-03T10:00:00.000Z'),
        status: 'NORMAL',
        notes: null,
        employee: {
          id: 1,
          employeeId: 'EMP001',
          name: '王小明',
          department: 'HR',
          position: '專員',
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/reports/attendance?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.report.employees[0].lateDays).toBe(1);
  });

  it.each([
    ['year=abc&month=3', '無效的年份參數'],
    ['year=2026&month=13', '無效的月份參數'],
    ['year=2026&month=3&employeeId=abc', '無效的員工編號參數'],
  ])('returns 400 for invalid query params: %s', async (queryString, expectedError) => {
    const request = new NextRequest(`http://localhost/api/reports/attendance?${queryString}`, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(expectedError);
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
  });
});
