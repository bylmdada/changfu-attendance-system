jest.mock('@/lib/database', () => ({
  prisma: {
    schedule: {
      findMany: jest.fn(),
    },
    holiday: {
      findMany: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '@/app/api/my-schedules/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('my-schedules route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 1,
      userId: 10,
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.holiday.findMany.mockResolvedValue([] as never);
  });

  it('rejects malformed month query parameters before hitting Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-schedules?year=2025&month=foo', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'month 參數格式無效' });
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
  });

  it('returns expected work hours from scheduled regular, special leave and comp leave hours', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 1,
        workDate: '2026-05-01',
        shiftType: 'A',
        startTime: '07:30',
        endTime: '16:30',
        breakTime: 60,
        workHours: 8,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 1,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z'),
        employee: {
          id: 1,
          employeeId: 'E001',
          name: '測試員工',
          department: '行政部',
          position: '社工',
        },
      },
      {
        id: 2,
        employeeId: 1,
        workDate: '2026-05-02',
        shiftType: 'FDL',
        startTime: '',
        endTime: '',
        breakTime: 0,
        workHours: 0,
        specialLeaveHours: 8,
        compLeaveHours: 0,
        overtimeHours: 0,
        createdAt: new Date('2026-05-02T00:00:00.000Z'),
        updatedAt: new Date('2026-05-02T00:00:00.000Z'),
        employee: {
          id: 1,
          employeeId: 'E001',
          name: '測試員工',
          department: '行政部',
          position: '社工',
        },
      },
      {
        id: 3,
        employeeId: 1,
        workDate: '2026-05-03',
        shiftType: 'OFF',
        startTime: '',
        endTime: '',
        breakTime: 0,
        workHours: 0,
        specialLeaveHours: 0,
        compLeaveHours: 8,
        overtimeHours: 0,
        createdAt: new Date('2026-05-03T00:00:00.000Z'),
        updatedAt: new Date('2026-05-03T00:00:00.000Z'),
        employee: {
          id: 1,
          employeeId: 'E001',
          name: '測試員工',
          department: '行政部',
          position: '社工',
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/my-schedules?year=2026&month=5', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.schedules.map((schedule: { expectedWorkHours: number }) => schedule.expectedWorkHours)).toEqual([8, 8, 8]);
  });

  it('normalizes legacy zero-hour timed shifts with shift definition hours', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 1,
        workDate: '2026-05-01',
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 0,
        workHours: 0,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 0,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z'),
        employee: {
          id: 1,
          employeeId: 'E001',
          name: '測試員工',
          department: '行政部',
          position: '社工',
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/my-schedules?year=2026&month=5', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.schedules).toEqual([
      expect.objectContaining({
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 60,
        workHours: 8,
        expectedWorkHours: 8,
      }),
    ]);
  });

  it('returns national holiday hours from active holiday dates without changing expected work hours', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 1,
        workDate: '2026-05-01',
        shiftType: 'A',
        startTime: '07:30',
        endTime: '16:30',
        breakTime: 60,
        workHours: 8,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 0,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z'),
        employee: {
          id: 1,
          employeeId: 'E001',
          name: '測試員工',
          department: '行政部',
          position: '社工',
        },
      },
      {
        id: 2,
        employeeId: 1,
        workDate: '2026-05-02',
        shiftType: 'A',
        startTime: '07:30',
        endTime: '16:30',
        breakTime: 60,
        workHours: 8,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 0,
        createdAt: new Date('2026-05-02T00:00:00.000Z'),
        updatedAt: new Date('2026-05-02T00:00:00.000Z'),
        employee: {
          id: 1,
          employeeId: 'E001',
          name: '測試員工',
          department: '行政部',
          position: '社工',
        },
      },
    ] as never);
    mockPrisma.holiday.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-01T00:00:00.000Z'),
        name: '勞動節',
      },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/my-schedules?year=2026&month=5', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.holiday.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        date: {
          gte: new Date('2026-05-01T00:00:00.000Z'),
          lte: new Date('2026-05-31T00:00:00.000Z'),
        },
      },
      select: {
        date: true,
        name: true,
      },
    });
    expect(payload.schedules.map((schedule: {
      expectedWorkHours: number;
      isNationalHoliday: boolean;
      nationalHolidayName: string | null;
      nationalHolidayHours: number;
    }) => ({
      expectedWorkHours: schedule.expectedWorkHours,
      isNationalHoliday: schedule.isNationalHoliday,
      nationalHolidayName: schedule.nationalHolidayName,
      nationalHolidayHours: schedule.nationalHolidayHours,
    }))).toEqual([
      {
        expectedWorkHours: 8,
        isNationalHoliday: true,
        nationalHolidayName: '勞動節',
        nationalHolidayHours: 8,
      },
      {
        expectedWorkHours: 8,
        isNationalHoliday: false,
        nationalHolidayName: null,
        nationalHolidayHours: 0,
      },
    ]);
  });
});