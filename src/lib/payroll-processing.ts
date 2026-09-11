import { prisma } from '@/lib/database';
import {
  calculateMonthlyPayroll,
  calculatePayrollTotals,
  normalizeDependentsCount,
  validatePayrollCalculation,
  type AttendanceForPayroll,
  type EmployeePayrollInfo,
} from '@/lib/payroll-calculator';
import { getStoredIncomeTaxManagementSettings, type IncomeTaxManagementSettings } from '@/lib/income-tax-settings';
import { OvertimeType } from '@/lib/overtime-calculator';
import {
  getStoredOvertimeCalculationSettings,
  type OvertimeCalculationSettings,
} from '@/lib/overtime-settings';
import {
  indexApprovedOvertimeRequests,
  resolveAttendanceOvertimeType,
  resolveApprovedAttendanceOvertime,
} from '@/lib/approved-overtime';
import { getAttendanceRegularTimeExclusions } from '@/lib/attendance-leave-hours';
import {
  getStoredDepartmentBonusConfigs,
  resolveEffectiveBonusConfig,
  type BonusConfigurationRecord,
} from '@/lib/bonus-config';
import {
  getEffectivePensionContributionRate,
  getTaiwanMonthStartUtc,
} from '@/lib/pension-contribution';
import type { LaborLawConfigValues } from '@/lib/labor-law-config-defaults';
import type { HealthInsuranceFormulaValues } from '@/lib/health-insurance-config';
import { getStoredHealthInsuranceFormulaConfig } from '@/lib/health-insurance-config';
import type { SupplementaryPremiumSettings } from '@/lib/supplementary-premium-config';
import { countActiveHealthInsuranceDependents } from '@/lib/health-insurance-dependent-sync';
import {
  getStoredAttendanceSalaryDeductionSettings,
  type AttendanceSalaryDeductionSettings,
} from '@/lib/attendance-salary-deduction-settings';
import { getScheduledAttendanceTiming, getStoredOrCalculatedAttendanceHours } from '@/lib/work-hours';
import {
  getTaiwanMonthEnd,
  getTaiwanMonthStart,
  getTaiwanTimeParts,
  toTaiwanDateStr,
} from '@/lib/timezone';
import { getEffectiveSalary } from '@/lib/salary-utils';
import { isAnnualLeaveType, isCompensatoryLeaveType } from '@/lib/leave-types';

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
  employeeId?: number;
  workDate: Date;
  regularHours: number | null;
  overtimeHours: number | null;
  clockInOvertimeId?: number | null;
  clockOutOvertimeId?: number | null;
  payableOvertimeHours?: number | null;
  overtimeType?: OvertimeType;
}

interface PayrollScheduleHourSource {
  workDate: string;
  shiftType?: string;
  startTime?: string;
  endTime?: string;
  breakTime?: number | null;
  workHours?: number | null;
  specialLeaveHours: number | null;
  compLeaveHours: number | null;
}

interface PayrollAttendancePenaltySchedule {
  workDate: string;
  startTime: string;
  endTime: string;
  workHours: number | null;
  specialLeaveHours: number | null;
  compLeaveHours: number | null;
  breakTime?: number | null;
}

interface PayrollAttendancePenaltyRecord {
  workDate: Date;
  clockInTime: Date | null;
  clockOutTime: Date | null;
}

export interface PayrollAttendancePenaltyDetail {
  workDate: string;
  status: '遲到' | '早退' | '遲到+早退' | '缺勤';
  scheduledStartTime: string;
  scheduledEndTime: string;
  clockInTime?: string;
  clockOutTime?: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  absentHours: number;
  deductionHours: number;
  hourlyWage: number;
  amount: number;
  formula: string;
}

export interface PayrollAttendancePenaltySummary {
  enabled: boolean;
  totalAmount: number;
  totalDeductionHours: number;
  lateCount: number;
  earlyLeaveCount: number;
  combinedCount: number;
  absentCount: number;
  details: PayrollAttendancePenaltyDetail[];
}

export interface PayrollBonusBreakdown {
  festivalBonus: number;
  yearEndBonus: number;
  otherBonus: number;
  totalBonus: number;
  bonusDetails: PayrollBonusDetail[];
  supplementaryPremiumFromRecords: number;
}

export interface PayrollBonusDetail {
  bonusType: string;
  bonusTypeName: string;
  amount: number;
  source: 'BONUS_RECORD' | 'CONFIG';
  supplementaryPremium: number;
  description?: string;
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

const EMPTY_ATTENDANCE_PENALTY_SUMMARY: PayrollAttendancePenaltySummary = {
  enabled: false,
  totalAmount: 0,
  totalDeductionHours: 0,
  lateCount: 0,
  earlyLeaveCount: 0,
  combinedCount: 0,
  absentCount: 0,
  details: [],
};

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

function roundConfiguredBonusAmount(amount: number) {
  return Math.round(amount);
}

function getNumberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getConfiguredBonusDetails(
  employee: Pick<PayrollProcessingEmployee, 'baseSalary' | 'hireDate'>,
  config: ReturnType<typeof resolveEffectiveBonusConfig>,
  year: number,
  month: number
): PayrollBonusDetail[] {
  if (!config.isActive) {
    return [];
  }

  const serviceMonths = calculatePayrollServiceMonths(employee.hireDate, year, month);
  const minimumServiceMonths = getNumberValue(config.eligibilityRules.minimumServiceMonths, 0);

  if (serviceMonths < minimumServiceMonths) {
    return [];
  }

  const proRateRatio = Math.min(serviceMonths / 12, 1);

  if (config.bonusType === 'YEAR_END') {
    const paymentMonth = getNumberValue(
      config.paymentSchedule.yearEndMonth ?? config.paymentSchedule.paymentMonth,
      2
    );

    if (month !== paymentMonth) {
      return [];
    }

    const baseMultiplier = getNumberValue(config.eligibilityRules.baseMultiplier, 1);
    const fullAmount = config.defaultAmount ?? employee.baseSalary * baseMultiplier;

    return [{
      bonusType: config.bonusType,
      bonusTypeName: config.bonusTypeName || '年終獎金',
      amount: roundConfiguredBonusAmount(fullAmount * proRateRatio),
      source: 'CONFIG',
      supplementaryPremium: 0,
    }];
  }

  if (config.bonusType === 'FESTIVAL') {
    const festivalMultipliers = (
      typeof config.eligibilityRules.festivalMultipliers === 'object' &&
      config.eligibilityRules.festivalMultipliers !== null
    )
      ? config.eligibilityRules.festivalMultipliers as Record<string, unknown>
      : {};

    const festivalSchedules = [
      {
        month: getNumberValue(config.paymentSchedule.springMonth, 2),
        multiplier: getNumberValue(festivalMultipliers.spring_festival, 0.5),
        name: '春節獎金',
      },
      {
        month: getNumberValue(config.paymentSchedule.dragonBoatMonth, 6),
        multiplier: getNumberValue(festivalMultipliers.dragon_boat, 0.3),
        name: '端午節獎金',
      },
      {
        month: getNumberValue(config.paymentSchedule.midAutumnMonth, 9),
        multiplier: getNumberValue(festivalMultipliers.mid_autumn, 0.3),
        name: '中秋節獎金',
      },
    ];

    return festivalSchedules
      .filter(festival => festival.month === month)
      .map(festival => ({
        bonusType: config.bonusType,
        bonusTypeName: festival.name,
        amount: roundConfiguredBonusAmount(employee.baseSalary * festival.multiplier * proRateRatio),
        source: 'CONFIG' as const,
        supplementaryPremium: 0,
      }));
  }

  const paymentMonth = getNumberValue(config.paymentSchedule.paymentMonth, 0);
  if (paymentMonth !== month || config.defaultAmount === null) {
    return [];
  }

  return [{
    bonusType: config.bonusType,
    bonusTypeName: config.bonusTypeName,
    amount: roundConfiguredBonusAmount(config.defaultAmount),
    source: 'CONFIG',
    supplementaryPremium: 0,
  }];
}

function summarizeBonusDetails(details: PayrollBonusDetail[]): PayrollBonusBreakdown {
  const yearEndBonus = details.reduce(
    (sum, detail) => sum + (detail.bonusType === 'YEAR_END' ? detail.amount : 0),
    0
  );
  const festivalBonus = details.reduce(
    (sum, detail) => sum + (detail.bonusType === 'FESTIVAL' ? detail.amount : 0),
    0
  );
  const totalBonus = details.reduce((sum, detail) => sum + detail.amount, 0);
  const supplementaryPremiumFromRecords = details.reduce(
    (sum, detail) => sum + (detail.source === 'BONUS_RECORD' ? detail.supplementaryPremium : 0),
    0
  );

  return {
    festivalBonus,
    yearEndBonus,
    otherBonus: totalBonus - festivalBonus - yearEndBonus,
    totalBonus,
    bonusDetails: details,
    supplementaryPremiumFromRecords,
  };
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

    let overtimeType = record.overtimeType ?? OvertimeType.WEEKDAY;
    if (!record.overtimeType && isHoliday) {
      overtimeType = OvertimeType.HOLIDAY;
    } else if (!record.overtimeType && dayOfWeek === 6) {
      overtimeType = OvertimeType.REST_DAY;
    } else if (!record.overtimeType && dayOfWeek === 0) {
      overtimeType = OvertimeType.MANDATORY_REST;
    }

    return {
      workDate: record.workDate,
      regularHours: record.regularHours || 0,
      overtimeHours: record.overtimeHours || 0,
      payableOvertimeHours: record.payableOvertimeHours ?? record.overtimeHours ?? 0,
      overtimeType,
      isHoliday,
      isRestDay: dayOfWeek === 6,
      isMandatoryRest: dayOfWeek === 0,
    };
  });
}

function toPayrollWorkDate(workDate: string): Date {
  return new Date(`${workDate}T00:00:00.000Z`);
}

export function buildPaidLeaveAttendanceForPayroll(
  schedules: PayrollScheduleHourSource[]
): AttendanceForPayroll[] {
  return schedules
    .map(schedule => ({
      schedule,
      paidLeaveHours: (schedule.specialLeaveHours || 0) + (schedule.compLeaveHours || 0),
    }))
    .filter(({ paidLeaveHours }) => paidLeaveHours > 0)
    .map(({ schedule, paidLeaveHours }) => ({
      workDate: toPayrollWorkDate(schedule.workDate),
      regularHours: paidLeaveHours,
      overtimeHours: 0,
      overtimeType: OvertimeType.WEEKDAY,
      isHoliday: false,
      isRestDay: false,
      isMandatoryRest: false,
    }));
}

function formatPayrollTime(date: Date | null | undefined) {
  if (!date) {
    return undefined;
  }

  const { hour, minute } = getTaiwanTimeParts(date);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function roundDeductionHours(hours: number) {
  return Math.round(hours * 100) / 100;
}

export function calculateAttendanceSalaryPenalty(params: {
  enabled: boolean;
  attendanceRecords: PayrollAttendancePenaltyRecord[];
  schedules: PayrollAttendancePenaltySchedule[];
  hourlyWage: number;
  employeeType?: string;
  paidLeaves?: Array<{ startTime: Date; endTime: Date }>;
}): PayrollAttendancePenaltySummary {
  if (!params.enabled || params.employeeType === 'HOURLY') {
    return { ...EMPTY_ATTENDANCE_PENALTY_SUMMARY };
  }

  const attendanceByDate = new Map(
    params.attendanceRecords.map(record => [
      toTaiwanDateStr(record.workDate),
      record,
    ])
  );
  const details: PayrollAttendancePenaltyDetail[] = [];

  for (const schedule of params.schedules) {
    const scheduledWorkHours = Math.max(0, schedule.workHours || 0);
    const paidLeaveHours = Math.max(0, (schedule.specialLeaveHours || 0) + (schedule.compLeaveHours || 0));
    const deductibleScheduledHours = Math.max(0, scheduledWorkHours - paidLeaveHours);

    if (
      deductibleScheduledHours <= 0 ||
      !schedule.startTime ||
      !schedule.endTime
    ) {
      continue;
    }

    const attendance = attendanceByDate.get(schedule.workDate);
    let status: PayrollAttendancePenaltyDetail['status'] | null = null;
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let absentHours = 0;

    if (!attendance?.clockInTime && !attendance?.clockOutTime) {
      status = '缺勤';
      absentHours = deductibleScheduledHours;
    } else {
      const timing = getScheduledAttendanceTiming({
        clockInTime: attendance?.clockInTime,
        clockOutTime: attendance?.clockOutTime,
        workHours: scheduledWorkHours,
        breakMinutes: schedule.breakTime ?? undefined,
        schedule: {
          workDate: schedule.workDate,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          regularTimeExclusions: params.paidLeaves,
        },
      });
      lateMinutes = timing.lateMinutes;
      earlyLeaveMinutes = timing.earlyLeaveMinutes;

      if (lateMinutes > 0 && earlyLeaveMinutes > 0) {
        status = '遲到+早退';
      } else if (lateMinutes > 0) {
        status = '遲到';
      } else if (earlyLeaveMinutes > 0) {
        status = '早退';
      }
    }

    if (!status) {
      continue;
    }

    const deductionHours = roundDeductionHours(
      status === '缺勤'
        ? absentHours
        : (lateMinutes + earlyLeaveMinutes) / 60
    );
    const amount = Math.round(deductionHours * params.hourlyWage);
    if (amount <= 0) {
      continue;
    }

    details.push({
      workDate: schedule.workDate,
      status,
      scheduledStartTime: schedule.startTime,
      scheduledEndTime: schedule.endTime,
      clockInTime: formatPayrollTime(attendance?.clockInTime),
      clockOutTime: formatPayrollTime(attendance?.clockOutTime),
      lateMinutes,
      earlyLeaveMinutes,
      absentHours: roundDeductionHours(absentHours),
      deductionHours,
      hourlyWage: params.hourlyWage,
      amount,
      formula: `NT$ ${params.hourlyWage.toLocaleString()} × ${deductionHours.toLocaleString()} 小時 = NT$ ${amount.toLocaleString()}`,
    });
  }

  return {
    enabled: true,
    totalAmount: details.reduce((sum, detail) => sum + detail.amount, 0),
    totalDeductionHours: roundDeductionHours(details.reduce((sum, detail) => sum + detail.deductionHours, 0)),
    lateCount: details.filter(detail => detail.status === '遲到').length,
    earlyLeaveCount: details.filter(detail => detail.status === '早退').length,
    combinedCount: details.filter(detail => detail.status === '遲到+早退').length,
    absentCount: details.filter(detail => detail.status === '缺勤').length,
    details,
  };
}

export async function calculateBonusForPayrollMonth(
  employee: Pick<PayrollProcessingEmployee, 'id' | 'baseSalary' | 'hireDate' | 'department'>,
  year: number,
  month: number
): Promise<PayrollBonusBreakdown> {
  try {
    const [configs, bonusRecords, departmentConfigs] = await Promise.all([
      prisma.bonusConfiguration.findMany({
        where: { isActive: true },
      }) as Promise<BonusConfigurationRecord[]>,
      prisma.bonusRecord.findMany({
        where: {
          employeeId: employee.id,
          payrollYear: year,
          payrollMonth: month,
        },
        orderBy: [
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
      }),
      getStoredDepartmentBonusConfigs(),
    ]);

    const configuredBonusDetails: PayrollBonusDetail[] = [];
    const manualBonusDetails: PayrollBonusDetail[] = bonusRecords.map(record => ({
      bonusType: record.bonusType,
      bonusTypeName: record.bonusTypeName,
      amount: roundConfiguredBonusAmount(record.amount),
      source: 'BONUS_RECORD',
      supplementaryPremium: roundConfiguredBonusAmount(record.supplementaryPremium),
      description: record.adjustmentReason || undefined,
    }));

    const manualBonusTypes = new Set(manualBonusDetails.map(detail => detail.bonusType));

    for (const config of configs) {
      if (manualBonusTypes.has(config.bonusType)) {
        continue;
      }

      const effectiveConfig = resolveEffectiveBonusConfig({
        bonusType: config.bonusType,
        defaultName: config.bonusTypeName || config.bonusType,
        config,
        department: employee.department,
        departmentConfigs,
      });

      configuredBonusDetails.push(
        ...getConfiguredBonusDetails(employee, effectiveConfig, year, month)
      );
    }

    return summarizeBonusDetails([...manualBonusDetails, ...configuredBonusDetails]);
  } catch (error) {
    console.error('計算獎金失敗:', error);
  }

  return summarizeBonusDetails([]);
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
  const fallbackDependents = normalizeDependentsCount(employee.dependents);
  const [laborPensionSelfRate, activeHealthDependentCount, effectiveSalary] = await Promise.all([
    getEffectivePensionContributionRate(
      prisma.pensionContributionApplication,
      employee.id,
      employee.laborPensionSelfRate || 0,
      getTaiwanMonthStartUtc(year, month + 1)
    ),
    countActiveHealthInsuranceDependents(prisma, employee.id, fallbackDependents),
    getEffectiveSalary(employee.id, getTaiwanMonthEnd(year, month), {
      baseSalary: employee.baseSalary,
      hourlyRate: employee.hourlyRate,
    }),
  ]);

  return {
    id: employee.id,
    employeeId: employee.employeeId,
    name: employee.name,
    baseSalary: effectiveSalary?.baseSalary ?? employee.baseSalary,
    hourlyRate: effectiveSalary?.hourlyRate ?? employee.hourlyRate,
    department: employee.department || '',
    position: employee.position || '',
    dependents: activeHealthDependentCount,
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
    healthInsuranceConfig?: HealthInsuranceFormulaValues;
    overtimeSettings?: Pick<OvertimeCalculationSettings, 'compensationMode' | 'overtimeMinUnit'>;
    incomeTaxSettings?: Pick<IncomeTaxManagementSettings, 'withholdingEnabled'>;
    attendanceSalaryDeductionSettings?: AttendanceSalaryDeductionSettings;
  }
) {
  const startDate = getTaiwanMonthStart(year, month);
  const endDate = getTaiwanMonthEnd(year, month);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = toTaiwanDateStr(endDate);

  const [
    resolvedOvertimeSettings,
    resolvedIncomeTaxSettings,
    resolvedHealthInsuranceConfig,
    resolvedAttendanceSalaryDeductionSettings,
  ] = await Promise.all([
    options.overtimeSettings
      ? Promise.resolve(options.overtimeSettings)
      : getStoredOvertimeCalculationSettings(),
    options.incomeTaxSettings
      ? Promise.resolve(options.incomeTaxSettings)
      : getStoredIncomeTaxManagementSettings(),
    options.healthInsuranceConfig
      ? Promise.resolve(options.healthInsuranceConfig)
      : getStoredHealthInsuranceFormulaConfig(),
    options.attendanceSalaryDeductionSettings
      ? Promise.resolve(options.attendanceSalaryDeductionSettings)
      : getStoredAttendanceSalaryDeductionSettings(),
  ]);
  const [
    attendanceRecords,
    approvedOvertimeRequests,
    approvedAttendanceLeaves,
    scheduleRecords,
    attendancePenaltySchedules,
  ] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        employeeId: employee.id,
        workDate: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    prisma.overtimeRequest.findMany({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        overtimeDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        employeeId: true,
        overtimeDate: true,
        totalHours: true,
        compensationType: true,
      },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        voidedAt: null,
        startDate: { lt: new Date(endDate.getTime() + 1) },
        endDate: { gte: startDate },
      },
      select: {
        startDate: true,
        endDate: true,
        leaveType: true,
        status: true,
        managerOpinion: true,
        voidedAt: true,
      },
    }),
    prisma.schedule.findMany({
      where: {
        employeeId: employee.id,
        workDate: {
          gte: monthStart,
          lte: monthEnd,
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
    }),
    resolvedAttendanceSalaryDeductionSettings.enabled
      ? prisma.schedule.findMany({
          where: {
            employeeId: employee.id,
            workDate: {
              gte: monthStart,
              lte: monthEnd,
            },
            workHours: { gt: 0 },
            shiftType: { notIn: ['TD', 'FDL', 'OFF', 'RD', 'rd', 'NH'] },
          },
          select: {
            workDate: true,
            startTime: true,
            endTime: true,
            workHours: true,
            breakTime: true,
            specialLeaveHours: true,
            compLeaveHours: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const approvedOvertimeIndex = indexApprovedOvertimeRequests(approvedOvertimeRequests);
  const scheduleByDate = new Map(scheduleRecords.map(schedule => [schedule.workDate, schedule]));
  const normalizedAttendanceRecords = attendanceRecords.map(record => {
    const schedule = scheduleByDate.get(toTaiwanDateStr(record.workDate));
    const hours = getStoredOrCalculatedAttendanceHours({
      ...record,
      breakTime: schedule?.breakTime,
      scheduledWorkHours: schedule?.workHours,
      scheduledStart: schedule?.startTime,
      scheduledEnd: schedule?.endTime,
      regularTimeExclusions: getAttendanceRegularTimeExclusions(approvedAttendanceLeaves),
    });
    const resolvedOvertimeType = resolveAttendanceOvertimeType({
      shiftType: schedule?.shiftType,
      workDate: record.workDate,
      isHoliday: options.holidayDates.has(toTaiwanDateStr(record.workDate)),
    });
    const validOvertime = resolveApprovedAttendanceOvertime(
      {
        ...record,
        regularHours: hours.regularHours,
        actualWorkHours: hours.totalHours,
        overtimeHours: hours.overtimeHours,
        overtimeType: resolvedOvertimeType,
      },
      approvedOvertimeIndex,
      resolvedOvertimeSettings.overtimeMinUnit
    );

    return {
      ...record,
      regularHours: validOvertime.regularHours,
      overtimeHours: validOvertime.effectiveHours,
      overtimeType: OvertimeType[resolvedOvertimeType],
      payableOvertimeHours:
        resolvedOvertimeSettings.compensationMode === 'EMPLOYEE_CHOICE'
          ? validOvertime.payableHours
          : validOvertime.effectiveHours,
    };
  });

  const attendanceForPayroll = [
    ...buildAttendanceForPayroll(normalizedAttendanceRecords, options.holidayDates),
    ...buildPaidLeaveAttendanceForPayroll(scheduleRecords),
  ];
  const employeeInfo = await buildEmployeePayrollInfo(employee, year, month);
  const attendancePenaltySummary = calculateAttendanceSalaryPenalty({
    enabled: resolvedAttendanceSalaryDeductionSettings.enabled,
    attendanceRecords,
    schedules: attendancePenaltySchedules,
    hourlyWage: employeeInfo.hourlyRate || 0,
    employeeType: employeeInfo.employeeType,
    paidLeaves: getAttendanceRegularTimeExclusions(approvedAttendanceLeaves.filter(leave =>
      isAnnualLeaveType(leave.leaveType) || isCompensatoryLeaveType(leave.leaveType)
    )),
  });
  const payrollResult = calculateMonthlyPayroll(employeeInfo, attendanceForPayroll, year, month, {
    overtimeCompensationMode: resolvedOvertimeSettings.compensationMode,
    incomeTaxEnabled: resolvedIncomeTaxSettings.withholdingEnabled,
    healthInsuranceConfig: resolvedHealthInsuranceConfig,
  });
  const validation = validatePayrollCalculation(payrollResult);
  const bonuses = options.includeBonus === false
    ? summarizeBonusDetails([])
    : await calculateBonusForPayrollMonth(employee, year, month);
  const totals = calculatePayrollTotals(
    employeeInfo,
    payrollResult.grossPay,
    bonuses.totalBonus,
    options.supplementaryPremiumSettings,
    options.laborLawConfig,
    {
      incomeTaxEnabled: resolvedIncomeTaxSettings.withholdingEnabled,
      bonusSupplementaryInsurance: bonuses.supplementaryPremiumFromRecords,
      healthInsuranceConfig: resolvedHealthInsuranceConfig,
    }
  );
  if (attendancePenaltySummary.totalAmount > 0) {
    totals.deductions.other += attendancePenaltySummary.totalAmount;
    totals.totalDeductions += attendancePenaltySummary.totalAmount;
    totals.netPay -= attendancePenaltySummary.totalAmount;
    payrollResult.calculationNotes.push(
      `考勤扣薪合計：NT$ ${attendancePenaltySummary.totalAmount.toLocaleString()}（${attendancePenaltySummary.totalDeductionHours.toLocaleString()} 小時 × 平日每小時工資額）`
    );
    for (const detail of attendancePenaltySummary.details) {
      payrollResult.calculationNotes.push(
        `${detail.workDate} ${detail.status}扣薪：${detail.formula}`
      );
    }
  }

  return {
    attendanceForPayroll,
    employeeInfo,
    payrollResult,
    validation,
    bonuses,
    totals,
    attendancePenaltySummary,
  };
}

export function buildPayrollRecordData(
  employee: PayrollProcessingEmployee,
  year: number,
  month: number,
  payrollResult: ReturnType<typeof calculateMonthlyPayroll>,
  totals: ReturnType<typeof calculatePayrollTotals>,
  bonuses: PayrollBonusBreakdown,
  disputeAdjustments: readonly PayrollDisputeAdjustmentDetail[] = [],
  dependentsCountUsed = normalizeDependentsCount(employee.dependents),
  attendancePenaltySummary: PayrollAttendancePenaltySummary = EMPTY_ATTENDANCE_PENALTY_SUMMARY
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
        ...bonuses.bonusDetails.map(detail =>
          `${detail.bonusTypeName}：NT$ ${detail.amount.toLocaleString()}${detail.source === 'BONUS_RECORD' ? '（獎金發放記錄）' : '（系統配置）'}`
        ),
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
      bonusSupplementaryInsurance: bonuses.supplementaryPremiumFromRecords,
      laborPensionSelf: totals.deductions.laborPensionSelf,
      incomeTax: totals.deductions.incomeTax,
      other: totals.deductions.other,
      bonusDetails: bonuses.bonusDetails,
      attendancePenalty: attendancePenaltySummary,
    },
    calculationNotes,
    dependentsCountUsed,
  };
}
