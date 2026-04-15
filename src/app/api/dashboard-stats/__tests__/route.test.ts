import { NextRequest } from 'next/server';
import { GET } from '@/app/api/dashboard-stats/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';

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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockEmployeeGroupBy = mockPrisma.employee.groupBy as jest.Mock;

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
});