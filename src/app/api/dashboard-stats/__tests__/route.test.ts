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
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    attendanceRecord: {
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
const mockEmployeeGroupBy = mockPrisma.employee.groupBy as jest.Mock;
const mockCalculateEligibility = calculateOvertimeRequestsEligibility as jest.MockedFunction<
  typeof calculateOvertimeRequestsEligibility
>;

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

    mockPrisma.employee.count.mockResolvedValue(1 as never);
    mockEmployeeGroupBy.mockResolvedValue([] as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);
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

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/dashboard-stats');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
  });

  it('limits supervisor dashboard statistics to manageable departments', async () => {
    const request = new NextRequest('http://localhost/api/dashboard-stats?year=2026&month=3', {
      headers: {
        cookie: 'auth-token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.employee.count).toHaveBeenCalledWith({
      where: {
        isActive: true,
        department: { in: ['製造部'] },
      },
    });
    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employee: {
            department: { in: ['製造部'] },
          },
        }),
      })
    );
  });

  it('calculates department rate from clocked-in attendance only', async () => {
    mockPrisma.employee.count.mockResolvedValue(2 as never);
    mockEmployeeGroupBy.mockResolvedValue([
      {
        department: '製造部',
        _count: { id: 2 },
      },
    ] as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          workDate: new Date('2026-03-02T00:00:00.000Z'),
          clockInTime: new Date('2026-03-02T01:00:00.000Z'),
          clockOutTime: new Date('2026-03-02T09:00:00.000Z'),
          employee: { id: 1, name: '王小明', department: '製造部' },
        },
        {
          workDate: new Date('2026-03-02T00:00:00.000Z'),
          clockInTime: null,
          clockOutTime: null,
          employee: { id: 2, name: '李小華', department: '製造部' },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const request = new NextRequest('http://localhost/api/dashboard-stats?year=2026&month=3');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.departments).toHaveLength(1);
    expect(payload.data.departments[0].attended).toBe(1);
    expect(payload.data.departments[0].rate).toBe(
      Math.round((1 / (2 * payload.data.period.workDays)) * 100)
    );
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
    mockPrisma.employee.count.mockResolvedValue(3 as never);
    mockPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { employeeId: 1, clockInTime: new Date('2026-07-01T00:00:00.000Z'), clockOutTime: null },
        { employeeId: 1, clockInTime: new Date('2026-07-01T01:00:00.000Z'), clockOutTime: null },
        { employeeId: 2, clockInTime: new Date('2026-07-01T00:05:00.000Z'), clockOutTime: new Date('2026-07-01T09:00:00.000Z') },
        { employeeId: 3, clockInTime: null, clockOutTime: null },
      ] as never);

    const request = new NextRequest('http://localhost/api/dashboard-stats?year=2026&month=7');
    const response = await GET(request);
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

    jest.useRealTimers();
  });

  it('uses actual eligible overtime instead of approved request duration', async () => {
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

    const response = await GET(new NextRequest('http://localhost/api/dashboard-stats?year=2026&month=3'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockCalculateEligibility).toHaveBeenCalledWith(approved);
    expect(payload.data.overtime.totalHours).toBe(0.19);
  });
});
