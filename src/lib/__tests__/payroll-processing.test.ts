jest.mock('@/lib/database', () => ({
  prisma: {
    bonusConfiguration: {
      findMany: jest.fn(),
    },
    bonusRecord: {
      findMany: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
    overtimeRequest: {
      findMany: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
    },
    schedule: {
      findMany: jest.fn(),
    },
    pensionContributionApplication: {
      findFirst: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
    salaryHistory: {
      findFirst: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/database';
import {
  buildAttendanceForPayroll,
  buildPaidLeaveAttendanceForPayroll,
  calculateBonusForPayrollMonth,
  calculateAttendanceSalaryPenalty,
  buildEmployeePayrollInfo,
  computePayrollForEmployee,
} from '../payroll-processing';
import { OvertimeType } from '@/lib/overtime-calculator';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('payroll processing bonus eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.bonusConfiguration.findMany.mockResolvedValue([] as never);
    mockPrisma.bonusRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.pensionContributionApplication.findFirst.mockResolvedValue(null as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.salaryHistory.findFirst.mockResolvedValue(null as never);
    mockPrisma.employee.findUnique.mockResolvedValue(null as never);
  });

  it('uses the salary history effective for the payroll month', async () => {
    mockPrisma.salaryHistory.findFirst.mockResolvedValue({
      baseSalary: 40000,
      hourlyRate: 167,
      effectiveDate: new Date('2026-07-05T05:03:07.000Z'),
    } as never);

    const employeeInfo = await buildEmployeePayrollInfo({
      id: 36,
      employeeId: '2026990001',
      name: '測試甲',
      baseSalary: 40100,
      hourlyRate: 167,
      hireDate: new Date('2026-06-14T00:00:00.000Z'),
      department: '蘇西日照中心',
      position: '日照中心主任',
      employeeType: 'MONTHLY',
    }, 2026, 7);

    expect(mockPrisma.salaryHistory.findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: 36,
        effectiveDate: { lte: new Date('2026-07-31T15:59:59.999Z') },
      },
      orderBy: [
        { effectiveDate: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });
    expect(employeeInfo.baseSalary).toBe(40000);
    expect(employeeInfo.hourlyRate).toBe(167);
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
        department: '行政部',
      },
      2025,
      4
    );

    expect(result.festivalBonus).toBe(30000);
    expect(result.totalBonus).toBe(30000);
  });

  it('prefers stored bonus records over configured department bonus formulas', async () => {
    mockPrisma.bonusConfiguration.findMany.mockResolvedValue([
      {
        bonusType: 'YEAR_END',
        bonusTypeName: '年終獎金',
        defaultAmount: null,
        eligibilityRules: {
          minimumServiceMonths: 1,
          baseMultiplier: 2,
        },
        paymentSchedule: {
          yearEndMonth: 2,
        },
        isActive: true,
      },
    ] as never);
    mockPrisma.bonusRecord.findMany.mockResolvedValue([
      {
        id: 11,
        bonusType: 'YEAR_END',
        bonusTypeName: '年終獎金',
        amount: 45678,
        supplementaryPremium: 321,
        adjustmentReason: null,
      },
    ] as never);

    const result = await calculateBonusForPayrollMonth(
      {
        id: 1,
        baseSalary: 30000,
        hireDate: new Date('2024-01-01T00:00:00.000Z'),
        department: '行政部',
      },
      2026,
      2
    );

    expect(result.yearEndBonus).toBe(45678);
    expect(result.totalBonus).toBe(45678);
    expect(result.supplementaryPremiumFromRecords).toBe(321);
    expect(result.bonusDetails).toEqual([
      expect.objectContaining({
        bonusType: 'YEAR_END',
        bonusTypeName: '年終獎金',
        amount: 45678,
        source: 'BONUS_RECORD',
      }),
    ]);
  });

  it('converts scheduled special and comp leave hours into paid regular payroll hours', () => {
    const attendance = buildPaidLeaveAttendanceForPayroll([
      { workDate: '2026-05-04', specialLeaveHours: 8, compLeaveHours: 0 },
      { workDate: '2026-05-05', specialLeaveHours: 0, compLeaveHours: 8 },
      { workDate: '2026-05-06', specialLeaveHours: 0, compLeaveHours: 0 },
    ]);

    expect(attendance).toHaveLength(2);
    expect(attendance[0]).toEqual(expect.objectContaining({
      regularHours: 8,
      overtimeHours: 0,
      isHoliday: false,
    }));
    expect(attendance[1]).toEqual(expect.objectContaining({
      regularHours: 8,
      overtimeHours: 0,
      isHoliday: false,
    }));
  });

  it('classifies overtime on active national holidays for payroll without changing regular hours', () => {
    const attendance = buildAttendanceForPayroll([
      {
        workDate: new Date('2026-05-01T00:00:00.000Z'),
        regularHours: 8,
        overtimeHours: 2,
      },
    ], new Set(['2026-05-01']));

    expect(attendance[0]).toEqual(expect.objectContaining({
      regularHours: 8,
      overtimeHours: 2,
      overtimeType: OvertimeType.HOLIDAY,
      isHoliday: true,
    }));
  });

  it('includes scheduled special and comp leave in hourly payroll base pay', async () => {
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
        compLeaveHours: 0,
      },
      {
        workDate: '2026-05-03',
        specialLeaveHours: 0,
        compLeaveHours: 8,
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
      },
      select: {
        workDate: true,
        shiftType: true,
        startTime: true,
        endTime: true,
        breakTime: true,
        workHours: true,
        specialLeaveHours: true,
        compLeaveHours: true,
      },
    });
    expect(result.payrollResult.regularHours).toBe(24);
    expect(result.payrollResult.basePay).toBe(2400);
  });

  it('respects overtime compensation mode and income tax settings during payroll computation', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate: new Date('2026-05-01T00:00:00.000Z'),
        regularHours: 8,
        overtimeHours: 2,
      },
    ] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 9,
        employeeId: 1,
        overtimeDate: new Date('2026-05-01T00:00:00.000Z'),
        totalHours: 2,
        compensationType: 'OVERTIME_PAY',
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);

    const result = await computePayrollForEmployee(
      {
        id: 1,
        employeeId: 'E001',
        name: '月薪員工',
        baseSalary: 36000,
        hourlyRate: 150,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
        department: '行政部',
        position: '專員',
        employeeType: 'MONTHLY',
      },
      2026,
      5,
      {
        holidayDates: new Set(),
        includeBonus: false,
        overtimeSettings: {
          compensationMode: 'COMP_LEAVE_ONLY',
          overtimeMinUnit: 30,
        },
        incomeTaxSettings: {
          withholdingEnabled: false,
        },
      }
    );

    expect(result.payrollResult.totalOvertimeHours).toBe(2);
    expect(result.payrollResult.totalOvertimePay).toBe(0);
    expect(result.totals.deductions.incomeTax).toBe(0);
  });

  it('does not pay approved weekday overtime until actual net work exceeds 8 hours', async () => {
    const workDate = new Date('2026-07-16T16:00:00.000Z');
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate,
        clockInTime: new Date('2026-07-17T01:00:00.000Z'),
        clockOutTime: new Date('2026-07-17T10:00:00.000Z'),
        regularHours: 7,
        overtimeHours: 1,
      },
    ] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 19,
        employeeId: 1,
        overtimeDate: workDate,
        totalHours: 1,
        compensationType: 'OVERTIME_PAY',
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        workDate: '2026-07-17',
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 60,
        workHours: 8,
        specialLeaveHours: 0,
        compLeaveHours: 0,
      },
    ] as never);

    const result = await computePayrollForEmployee(
      {
        id: 1,
        employeeId: 'E001',
        name: '月薪員工',
        baseSalary: 36000,
        hourlyRate: 150,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
        department: '行政部',
        position: '專員',
        employeeType: 'MONTHLY',
      },
      2026,
      7,
      {
        holidayDates: new Set(),
        includeBonus: false,
        overtimeSettings: {
          compensationMode: 'OVERTIME_PAY_ONLY',
          overtimeMinUnit: 30,
        },
      }
    );

    expect(result.payrollResult.regularHours).toBe(8);
    expect(result.payrollResult.totalOvertimeHours).toBe(0);
    expect(result.payrollResult.totalOvertimePay).toBe(0);
  });

  it('excludes attendance overtime from payroll when there is no approved overtime request', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate: new Date('2026-05-01T00:00:00.000Z'),
        regularHours: 8,
        overtimeHours: 2,
      },
    ] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);

    const result = await computePayrollForEmployee(
      {
        id: 1,
        employeeId: 'E001',
        name: '月薪員工',
        baseSalary: 36000,
        hourlyRate: 150,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
        department: '行政部',
        position: '專員',
        employeeType: 'MONTHLY',
      },
      2026,
      5,
      {
        holidayDates: new Set(),
        includeBonus: false,
        overtimeSettings: {
          compensationMode: 'OVERTIME_PAY_ONLY',
          overtimeMinUnit: 30,
        },
      }
    );

    expect(result.payrollResult.totalOvertimeHours).toBe(0);
    expect(result.payrollResult.totalOvertimePay).toBe(0);
  });

  it('only pays approved overtime hours marked for overtime pay when employee choice is enabled', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate: new Date('2026-05-01T00:00:00.000Z'),
        regularHours: 8,
        overtimeHours: 3,
      },
    ] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([
      {
        id: 10,
        employeeId: 1,
        overtimeDate: new Date('2026-05-01T00:00:00.000Z'),
        totalHours: 3,
        compensationType: 'COMP_LEAVE',
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);

    const result = await computePayrollForEmployee(
      {
        id: 1,
        employeeId: 'E001',
        name: '月薪員工',
        baseSalary: 36000,
        hourlyRate: 150,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
        department: '行政部',
        position: '專員',
        employeeType: 'MONTHLY',
      },
      2026,
      5,
      {
        holidayDates: new Set(),
        includeBonus: false,
        overtimeSettings: {
          compensationMode: 'EMPLOYEE_CHOICE',
          overtimeMinUnit: 30,
        },
      }
    );

    expect(result.payrollResult.totalOvertimeHours).toBe(3);
    expect(result.payrollResult.totalOvertimePay).toBe(0);
  });

  it('deducts enabled attendance salary penalties from payroll totals with auditable details', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate: new Date('2026-05-01T00:00:00.000Z'),
        clockInTime: new Date('2026-05-01T01:30:00.000Z'),
        clockOutTime: new Date('2026-05-01T10:00:00.000Z'),
        regularHours: 7.5,
        overtimeHours: 0,
      },
      {
        employeeId: 1,
        workDate: new Date('2026-05-02T00:00:00.000Z'),
        clockInTime: new Date('2026-05-02T01:15:00.000Z'),
        clockOutTime: new Date('2026-05-02T09:30:00.000Z'),
        regularHours: 7.25,
        overtimeHours: 0,
      },
    ] as never);
    mockPrisma.schedule.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          workDate: '2026-05-01',
          startTime: '09:00',
          endTime: '18:00',
          workHours: 8,
          specialLeaveHours: 0,
          compLeaveHours: 0,
        },
        {
          workDate: '2026-05-02',
          startTime: '09:00',
          endTime: '18:00',
          workHours: 8,
          specialLeaveHours: 0,
          compLeaveHours: 0,
        },
        {
          workDate: '2026-05-03',
          startTime: '09:00',
          endTime: '18:00',
          workHours: 8,
          specialLeaveHours: 0,
          compLeaveHours: 0,
        },
      ] as never);

    const result = await computePayrollForEmployee(
      {
        id: 1,
        employeeId: 'E001',
        name: '月薪員工',
        baseSalary: 36000,
        hourlyRate: 150,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
        department: '行政部',
        position: '專員',
        employeeType: 'MONTHLY',
      },
      2026,
      5,
      {
        holidayDates: new Set(),
        includeBonus: false,
        attendanceSalaryDeductionSettings: {
          enabled: true,
          description: '',
        },
      }
    );

    expect(result.attendancePenaltySummary.totalAmount).toBe(1388);
    expect(result.attendancePenaltySummary.details.map(detail => detail.status)).toEqual([
      '遲到',
      '遲到+早退',
      '缺勤',
    ]);
    expect(result.totals.deductions.other).toBe(1388);
    expect(result.totals.totalDeductions).toBeGreaterThan(1388);
    expect(result.payrollResult.calculationNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('考勤扣薪合計'),
        expect.stringContaining('2026-05-03 缺勤扣薪'),
      ])
    );
    expect(mockPrisma.schedule.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          shiftType: { notIn: ['TD', 'FDL', 'OFF', 'RD', 'rd', 'NH'] },
        }),
      })
    );
  });

  it('calculates attendance penalty details deterministically', () => {
    const penalty = calculateAttendanceSalaryPenalty({
      enabled: true,
      hourlyWage: 150,
      attendanceRecords: [
        {
          workDate: new Date('2026-05-01T00:00:00.000Z'),
          clockInTime: new Date('2026-05-01T01:10:00.000Z'),
          clockOutTime: new Date('2026-05-01T09:50:00.000Z'),
        },
      ],
      schedules: [
        {
          workDate: '2026-05-01',
          startTime: '09:00',
          endTime: '18:00',
          workHours: 8,
          specialLeaveHours: 0,
          compLeaveHours: 0,
        },
      ],
    });

    expect(penalty.totalAmount).toBe(50);
    expect(penalty.details[0]).toEqual(expect.objectContaining({
      status: '遲到+早退',
      clockInTime: '09:10',
      clockOutTime: '17:50',
      lateMinutes: 10,
      earlyLeaveMinutes: 10,
      deductionHours: 0.33,
    }));
  });
});


describe('paid leave and hourly attendance deductions', () => {
  const input = {
    enabled: true, hourlyWage: 150,
    schedules: [{workDate: '2026-09-11', startTime: '09:00', endTime: '18:00', workHours: 8,
      specialLeaveHours: 2, compLeaveHours: 0}],
    attendanceRecords: [{workDate: new Date('2026-09-11T00:00:00+08:00'),
      clockInTime: new Date('2026-09-11T11:00:00+08:00'), clockOutTime: new Date('2026-09-11T18:00:00+08:00')}],
  };
  it('excludes approved morning leave but still charges actual lateness', () => {
    const paidLeaves = [{startTime:new Date('2026-09-11T09:00:00+08:00'), endTime:new Date('2026-09-11T11:00:00+08:00')}];
    expect(calculateAttendanceSalaryPenalty({...input, paidLeaves}).totalAmount).toBe(0);
    expect(calculateAttendanceSalaryPenalty({...input, paidLeaves, attendanceRecords: [{...input.attendanceRecords[0],
      clockInTime:new Date('2026-09-11T11:30:00+08:00')}]}).totalAmount).toBe(75);
  });
  it('does not deduct missing hourly work twice but retains monthly deductions', () => {
    expect(calculateAttendanceSalaryPenalty({...input, employeeType:'HOURLY'}).totalAmount).toBe(0);
    expect(calculateAttendanceSalaryPenalty({...input, employeeType:'MONTHLY'}).totalAmount).toBe(300);
  });
});
