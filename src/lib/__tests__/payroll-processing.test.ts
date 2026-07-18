jest.mock('@/lib/database', () => ({
  prisma: {
    bonusConfiguration: {
      findMany: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
    schedule: {
      findMany: jest.fn(),
    },
    pensionContributionApplication: {
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/database';
import {
  buildPaidLeaveAttendanceForPayroll,
  calculateBonusForPayrollMonth,
  computePayrollForEmployee,
} from '../payroll-processing';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('payroll processing bonus eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.bonusConfiguration.findMany.mockResolvedValue([] as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.pensionContributionApplication.findFirst.mockResolvedValue(null as never);
  });

  it('counts calendar service months correctly for month-end hires', async () => {
    mockPrisma.bonusConfiguration.findMany.mockResolvedValue([
      {
        bonusType: 'FESTIVAL',
        eligibilityRules: {
          minimumServiceMonths: 15,
          festivalMultipliers: {
            spring_festival: 1,
          },
        },
        paymentSchedule: {
          springMonth: 4,
        },
      },
    ] as never);

    const result = await calculateBonusForPayrollMonth(
      {
        id: 1,
        baseSalary: 30000,
        hireDate: new Date('2024-01-31T00:00:00.000Z'),
      },
      2025,
      4
    );

    expect(result.festivalBonus).toBe(30000);
    expect(result.totalBonus).toBe(30000);
  });

  it('converts scheduled special leave hours into paid regular payroll hours', () => {
    const attendance = buildPaidLeaveAttendanceForPayroll([
      { workDate: '2026-05-04', specialLeaveHours: 8 },
      { workDate: '2026-05-05', specialLeaveHours: 0 },
    ]);

    expect(attendance).toHaveLength(1);
    expect(attendance[0]).toEqual(expect.objectContaining({
      regularHours: 8,
      overtimeHours: 0,
      isHoliday: false,
    }));
  });

  it('includes scheduled special leave in hourly payroll base pay without paying comp leave by schedule alone', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        workDate: new Date('2026-05-01T00:00:00.000Z'),
        regularHours: 8,
        overtimeHours: 0,
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        workDate: '2026-05-02',
        specialLeaveHours: 8,
      },
    ] as never);

    const result = await computePayrollForEmployee(
      {
        id: 1,
        employeeId: 'E001',
        name: '計時員工',
        baseSalary: 24000,
        hourlyRate: 100,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
        department: '行政部',
        position: '專員',
        employeeType: 'HOURLY',
      },
      2026,
      5,
      {
        holidayDates: new Set(),
        includeBonus: false,
      }
    );

    expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith({
      where: {
        employeeId: 1,
        workDate: {
          gte: '2026-05-01',
          lte: '2026-05-31',
        },
        specialLeaveHours: {
          gt: 0,
        },
      },
      select: {
        workDate: true,
        specialLeaveHours: true,
      },
    });
    expect(result.payrollResult.regularHours).toBe(16);
    expect(result.payrollResult.basePay).toBe(1600);
  });
});
