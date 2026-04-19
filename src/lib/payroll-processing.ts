import { prisma } from '@/lib/database';
import {
  calculateMonthlyPayroll,
  calculatePayrollTotals,
  normalizeDependentsCount,
  validatePayrollCalculation,
  type AttendanceForPayroll,
  type EmployeePayrollInfo,
} from '@/lib/payroll-calculator';
import { OvertimeType } from '@/lib/overtime-calculator';
import {
  getEffectivePensionContributionRate,
  getTaiwanMonthStartUtc,
} from '@/lib/pension-contribution';
import type { LaborLawConfigValues } from '@/lib/labor-law-config-defaults';
import type { SupplementaryPremiumSettings } from '@/lib/supplementary-premium-config';

export interface PayrollProcessingEmployee {
  id: number;
  employeeId: string;
  name: string;
  baseSalary: number;
  hourlyRate: number;
  hireDate: Date;
  department: string | null;
  position: string | null;
  dependents?: number | null;
  insuredBase?: number | null;
  laborPensionSelfRate?: number | null;
  employeeType?: string | null;
  laborInsuranceActive?: boolean | null;
  healthInsuranceActive?: boolean | null;
}

interface PayrollAttendanceSource {
  workDate: Date;
  regularHours: number | null;
  overtimeHours: number | null;
}

export interface PayrollBonusBreakdown {
  festivalBonus: number;
  yearEndBonus: number;
  totalBonus: number;
}

export interface PayrollDisputeAdjustmentDetail {
  disputeId: number;
  type: 'SUPPLEMENT' | 'DEDUCTION';
  category: string;
  description: string;
  amount: number;
  originalYear: number;
  originalMonth: number;
}

export interface PayrollDisputeAdjustmentSummary {
  supplementTotal: number;
  deductionTotal: number;
  netAdjustment: number;
  notes: string[];
}

function calculatePayrollServiceMonths(hireDate: Date, year: number, month: number): number {
  const payrollMonthStart = new Date(year, month - 1, 1);

  if (hireDate > payrollMonthStart) {
    return 0;
  }

  return Math.max(
    0,
    (payrollMonthStart.getFullYear() - hireDate.getFullYear()) * 12
      + (payrollMonthStart.getMonth() - hireDate.getMonth())
  );
}

export async function getPayrollHolidayDates(year: number, month: number): Promise<Set<string>> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const holidays = await prisma.holiday.findMany({
    where: {
      year,
      isActive: true,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  return new Set(holidays.map(holiday => holiday.date.toISOString().split('T')[0]));
}

export function buildAttendanceForPayroll(
  records: PayrollAttendanceSource[],
  holidayDates: Set<string>
): AttendanceForPayroll[] {
  return records.map(record => {
    const dateStr = record.workDate.toISOString().split('T')[0];
    const dayOfWeek = record.workDate.getDay();
    const isHoliday = holidayDates.has(dateStr);

    let overtimeType = OvertimeType.WEEKDAY;
    if (isHoliday) {
      overtimeType = OvertimeType.HOLIDAY;
    } else if (dayOfWeek === 6) {
      overtimeType = OvertimeType.REST_DAY;
    } else if (dayOfWeek === 0) {
      overtimeType = OvertimeType.MANDATORY_REST;
    }

    return {
      workDate: record.workDate,
      regularHours: record.regularHours || 0,
      overtimeHours: record.overtimeHours || 0,
      overtimeType,
      isHoliday,
      isRestDay: dayOfWeek === 6,
      isMandatoryRest: dayOfWeek === 0,
    };
  });
}

export async function calculateBonusForPayrollMonth(
  employee: Pick<PayrollProcessingEmployee, 'id' | 'baseSalary' | 'hireDate'>,
  year: number,
  month: number
): Promise<PayrollBonusBreakdown> {
  let festivalBonus = 0;
  let yearEndBonus = 0;

  try {
    const configs = await prisma.bonusConfiguration.findMany({
      where: { isActive: true },
    });

    for (const config of configs) {
      const eligibilityRules = typeof config.eligibilityRules === 'string'
        ? JSON.parse(config.eligibilityRules)
        : config.eligibilityRules || {};

      const paymentSchedule = typeof config.paymentSchedule === 'string'
        ? JSON.parse(config.paymentSchedule)
        : config.paymentSchedule || {};

      const serviceMonths = calculatePayrollServiceMonths(employee.hireDate, year, month);

      const minimumServiceMonths = eligibilityRules.minimumServiceMonths || 0;
      if (serviceMonths < minimumServiceMonths) {
        continue;
      }

      const proRateRatio = Math.min(serviceMonths / 12, 1);

      if (config.bonusType === 'YEAR_END') {
        const paymentMonth = paymentSchedule.yearEndMonth || 2;
        if (month === paymentMonth) {
          const baseMultiplier = eligibilityRules.baseMultiplier || 1;
          yearEndBonus = Math.round(employee.baseSalary * baseMultiplier * proRateRatio);
        }
      } else if (config.bonusType === 'FESTIVAL') {
        const festivalMultipliers = eligibilityRules.festivalMultipliers || {};

        if (month === (paymentSchedule.springMonth || 2)) {
          const multiplier = festivalMultipliers.spring_festival || 0.5;
          festivalBonus += Math.round(employee.baseSalary * multiplier * proRateRatio);
        }
        if (month === (paymentSchedule.dragonBoatMonth || 6)) {
          const multiplier = festivalMultipliers.dragon_boat || 0.3;
          festivalBonus += Math.round(employee.baseSalary * multiplier * proRateRatio);
        }
        if (month === (paymentSchedule.midAutumnMonth || 9)) {
          const multiplier = festivalMultipliers.mid_autumn || 0.3;
          festivalBonus += Math.round(employee.baseSalary * multiplier * proRateRatio);
        }
      }
    }
  } catch (error) {
    console.error('計算獎金失敗:', error);
  }

  return {
    festivalBonus,
    yearEndBonus,
    totalBonus: festivalBonus + yearEndBonus,
  };
}

export async function getPendingApprovedPayrollDisputeAdjustments(
  employeeId: number,
  year: number,
  month: number
): Promise<PayrollDisputeAdjustmentDetail[]> {
  const disputes = await prisma.payrollDispute.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      adjustInYear: year,
      adjustInMonth: month,
      adjustment: {
        is: null,
      },
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  return disputes
    .filter(
      (dispute): dispute is typeof dispute & { adjustedAmount: number } =>
        typeof dispute.adjustedAmount === 'number' &&
        Number.isFinite(dispute.adjustedAmount) &&
        dispute.adjustedAmount !== 0
    )
    .map(dispute => ({
      disputeId: dispute.id,
      type: dispute.adjustedAmount >= 0 ? 'SUPPLEMENT' : 'DEDUCTION',
      category:
        dispute.type === 'OVERTIME_MISSING'
          ? 'OVERTIME'
          : dispute.type === 'LEAVE_MISSING'
            ? 'LEAVE'
            : dispute.type === 'ALLOWANCE_MISSING'
              ? 'ALLOWANCE'
              : 'OTHER',
      description:
        dispute.reviewNote?.trim() ||
        `${dispute.payYear}年${dispute.payMonth}月${dispute.type === 'OVERTIME_MISSING'
          ? '加班費補發'
          : dispute.type === 'LEAVE_MISSING'
            ? '請假扣款調整'
            : dispute.type === 'CALCULATION_ERROR'
              ? '計算錯誤調整'
              : dispute.type === 'ALLOWANCE_MISSING'
                ? '津貼補發'
                : dispute.type === 'DEDUCTION_ERROR'
                  ? '扣款錯誤調整'
                  : '薪資調整'}`,
      amount: Math.abs(dispute.adjustedAmount),
      originalYear: dispute.payYear,
      originalMonth: dispute.payMonth,
    }));
}

export function summarizePayrollDisputeAdjustments(
  adjustments: readonly Pick<PayrollDisputeAdjustmentDetail, 'type' | 'description' | 'amount'>[]
): PayrollDisputeAdjustmentSummary {
  const supplementTotal = adjustments.reduce(
    (sum, adjustment) => sum + (adjustment.type === 'SUPPLEMENT' ? adjustment.amount : 0),
    0
  );
  const deductionTotal = adjustments.reduce(
    (sum, adjustment) => sum + (adjustment.type === 'DEDUCTION' ? adjustment.amount : 0),
    0
  );

  return {
    supplementTotal,
    deductionTotal,
    netAdjustment: supplementTotal - deductionTotal,
    notes: adjustments.map(adjustment =>
      `${adjustment.type === 'SUPPLEMENT' ? '薪資異議補發' : '薪資異議扣除'}：NT$ ${adjustment.amount.toLocaleString()}（${adjustment.description}）`
    ),
  };
}

export async function buildEmployeePayrollInfo(
  employee: PayrollProcessingEmployee,
  year: number,
  month: number
): Promise<EmployeePayrollInfo> {
  const laborPensionSelfRate = await getEffectivePensionContributionRate(
    prisma.pensionContributionApplication,
    employee.id,
    employee.laborPensionSelfRate || 0,
    getTaiwanMonthStartUtc(year, month + 1)
  );

  return {
    id: employee.id,
    employeeId: employee.employeeId,
    name: employee.name,
    baseSalary: employee.baseSalary,
    hourlyRate: employee.hourlyRate,
    department: employee.department || '',
    position: employee.position || '',
      dependents: normalizeDependentsCount(employee.dependents),
    insuredBase: employee.insuredBase || undefined,
    laborPensionSelfRate,
    employeeType: employee.employeeType || 'MONTHLY',
    laborInsuranceActive: employee.laborInsuranceActive !== false,
    healthInsuranceActive: employee.healthInsuranceActive !== false,
  };
}

export async function computePayrollForEmployee(
  employee: PayrollProcessingEmployee,
  year: number,
  month: number,
  options: {
    holidayDates: Set<string>;
    includeBonus?: boolean;
    supplementaryPremiumSettings?: SupplementaryPremiumSettings;
    laborLawConfig?: LaborLawConfigValues;
  }
) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: {
      employeeId: employee.id,
      workDate: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  const attendanceForPayroll = buildAttendanceForPayroll(attendanceRecords, options.holidayDates);
  const employeeInfo = await buildEmployeePayrollInfo(employee, year, month);
  const payrollResult = calculateMonthlyPayroll(employeeInfo, attendanceForPayroll, year, month);
  const validation = validatePayrollCalculation(payrollResult);
  const bonuses = options.includeBonus === false
    ? { festivalBonus: 0, yearEndBonus: 0, totalBonus: 0 }
    : await calculateBonusForPayrollMonth(employee, year, month);
  const totals = calculatePayrollTotals(
    employeeInfo,
    payrollResult.grossPay,
    bonuses.totalBonus,
    options.supplementaryPremiumSettings,
    options.laborLawConfig
  );

  return {
    attendanceForPayroll,
    employeeInfo,
    payrollResult,
    validation,
    bonuses,
    totals,
  };
}

export function buildPayrollRecordData(
  employee: PayrollProcessingEmployee,
  year: number,
  month: number,
  payrollResult: ReturnType<typeof calculateMonthlyPayroll>,
  totals: ReturnType<typeof calculatePayrollTotals>,
  bonuses: PayrollBonusBreakdown,
  disputeAdjustments: readonly PayrollDisputeAdjustmentDetail[] = []
) {
  const overtimePayByType = {
    weekday: 0,
    restDay: 0,
    holiday: 0,
    mandatoryRest: 0,
  };

  for (const detail of payrollResult.overtimeDetails) {
    switch (detail.type) {
      case OvertimeType.WEEKDAY:
        overtimePayByType.weekday = detail.overtimePay;
        break;
      case OvertimeType.REST_DAY:
        overtimePayByType.restDay = detail.overtimePay;
        break;
      case OvertimeType.HOLIDAY:
        overtimePayByType.holiday = detail.overtimePay;
        break;
      case OvertimeType.MANDATORY_REST:
        overtimePayByType.mandatoryRest = detail.overtimePay;
        break;
      }
  }

  const disputeAdjustmentSummary = summarizePayrollDisputeAdjustments(disputeAdjustments);
  const baseCalculationNotes = bonuses.totalBonus > 0
    ? [
        ...payrollResult.calculationNotes,
        `三節獎金：NT$ ${bonuses.festivalBonus.toLocaleString()}`,
        `年終獎金：NT$ ${bonuses.yearEndBonus.toLocaleString()}`,
      ]
    : payrollResult.calculationNotes;
  const calculationNotes = [
    ...baseCalculationNotes,
    ...disputeAdjustmentSummary.notes,
  ];

  return {
    employeeId: employee.id,
    payYear: year,
    payMonth: month,
    regularHours: payrollResult.regularHours,
    overtimeHours: payrollResult.totalOvertimeHours,
    weekdayOvertimeHours: payrollResult.overtimeBreakdown.weekdayHours,
    restDayOvertimeHours: payrollResult.overtimeBreakdown.restDayHours,
    holidayOvertimeHours: payrollResult.overtimeBreakdown.holidayHours,
    mandatoryRestOvertimeHours: payrollResult.overtimeBreakdown.mandatoryRestHours,
    hourlyWage: payrollResult.hourlyWage,
    basePay: payrollResult.basePay,
    overtimePay: payrollResult.totalOvertimePay,
    weekdayOvertimePay: overtimePayByType.weekday,
    restDayOvertimePay: overtimePayByType.restDay,
    holidayOvertimePay: overtimePayByType.holiday,
    mandatoryRestOvertimePay: overtimePayByType.mandatoryRest,
    grossPay: totals.grossPay + disputeAdjustmentSummary.supplementTotal,
    laborInsurance: totals.deductions.laborInsurance,
    healthInsurance: totals.deductions.healthInsurance,
    supplementaryInsurance: totals.deductions.supplementaryInsurance,
    laborPensionSelf: totals.deductions.laborPensionSelf,
    incomeTax: totals.deductions.incomeTax,
    totalDeductions: totals.totalDeductions + disputeAdjustmentSummary.deductionTotal,
    netPay: totals.netPay + disputeAdjustmentSummary.netAdjustment,
    overtimeCalculationDetails: payrollResult.overtimeDetails,
    deductionDetails: {
      laborInsurance: totals.deductions.laborInsurance,
      healthInsurance: totals.deductions.healthInsurance,
      supplementaryInsurance: totals.deductions.supplementaryInsurance,
      laborPensionSelf: totals.deductions.laborPensionSelf,
      incomeTax: totals.deductions.incomeTax,
      other: totals.deductions.other,
    },
    calculationNotes,
    dependentsCountUsed: normalizeDependentsCount(employee.dependents),
  };
}
