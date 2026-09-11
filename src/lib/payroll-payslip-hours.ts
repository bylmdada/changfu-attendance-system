import { prisma } from '@/lib/database';
import { listShiftDefinitions } from '@/lib/shift-definition-service';
import { resolveScheduleHourFields } from '@/lib/shift-definition-utils';

export interface PayrollRecordHourSource {
  employeeId: number;
  payYear: number;
  payMonth: number;
  regularHours: number;
  overtimeHours: number;
  weekdayOvertimeHours?: number | null;
  restDayOvertimeHours?: number | null;
  holidayOvertimeHours?: number | null;
  mandatoryRestOvertimeHours?: number | null;
}

export interface PayslipHourSummary {
  expectedWorkHours: number;
  actualWorkHours: number;
  specialLeaveHours: number;
  compLeaveHours: number;
  scheduledOvertimeHours: number;
  nationalHolidayHours: number;
  scheduledAccountedHours: number;
  payrollRegularHours: number;
  payrollOvertimeHours: number;
  payrollTotalHours: number;
  overtimeBreakdown: {
    weekday: number;
    restDay: number;
    holiday: number;
    mandatoryRest: number;
  };
}

function roundHours(hours: number) {
  return Math.round(hours * 100) / 100;
}

function toDateOnly(date: Date) {
  return date.toISOString().split('T')[0];
}

function toUtcDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function getMonthDateRange(year: number, month: number) {
  const monthText = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${monthText}-01`,
    end: `${year}-${monthText}-${String(lastDay).padStart(2, '0')}`,
  };
}

export async function buildPayslipHourSummary(
  payrollRecord: PayrollRecordHourSource
): Promise<PayslipHourSummary> {
  const { start, end } = getMonthDateRange(payrollRecord.payYear, payrollRecord.payMonth);

  const [schedules, shiftDefinitions, holidays] = await Promise.all([
    prisma.schedule.findMany({
      where: {
        employeeId: payrollRecord.employeeId,
        workDate: {
          gte: start,
          lte: end,
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
        overtimeHours: true,
      },
    }),
    listShiftDefinitions({ includeInactive: true }),
    prisma.holiday.findMany({
      where: {
        isActive: true,
        date: {
          gte: toUtcDate(start),
          lte: toUtcDate(end),
        },
      },
      select: {
        date: true,
      },
    }),
  ]);

  const holidayDates = new Set(holidays.map(holiday => toDateOnly(holiday.date)));
  const effectiveSchedules = schedules.map((schedule) => resolveScheduleHourFields(schedule, shiftDefinitions));
  const scheduledWorkHours = effectiveSchedules.reduce((sum, schedule) => sum + schedule.workHours, 0);
  const specialLeaveHours = effectiveSchedules.reduce((sum, schedule) => sum + schedule.specialLeaveHours, 0);
  const compLeaveHours = effectiveSchedules.reduce((sum, schedule) => sum + schedule.compLeaveHours, 0);
  const scheduledOvertimeHours = effectiveSchedules.reduce((sum, schedule) => sum + schedule.overtimeHours, 0);
  const nationalHolidayHours = schedules.reduce(
    (sum, schedule, index) => sum + (holidayDates.has(schedule.workDate) ? effectiveSchedules[index].workHours : 0),
    0
  );

  return {
    expectedWorkHours: roundHours(scheduledWorkHours + specialLeaveHours + compLeaveHours),
    actualWorkHours: roundHours(Math.max(
      0,
      payrollRecord.regularHours
        + payrollRecord.overtimeHours
        - specialLeaveHours
        - compLeaveHours
    )),
    specialLeaveHours: roundHours(specialLeaveHours),
    compLeaveHours: roundHours(compLeaveHours),
    scheduledOvertimeHours: roundHours(scheduledOvertimeHours),
    nationalHolidayHours: roundHours(nationalHolidayHours),
    scheduledAccountedHours: roundHours(scheduledWorkHours + specialLeaveHours + compLeaveHours + scheduledOvertimeHours),
    payrollRegularHours: roundHours(payrollRecord.regularHours),
    payrollOvertimeHours: roundHours(payrollRecord.overtimeHours),
    payrollTotalHours: roundHours(payrollRecord.regularHours + payrollRecord.overtimeHours),
    overtimeBreakdown: {
      weekday: roundHours(payrollRecord.weekdayOvertimeHours ?? 0),
      restDay: roundHours(payrollRecord.restDayOvertimeHours ?? 0),
      holiday: roundHours(payrollRecord.holidayOvertimeHours ?? 0),
      mandatoryRest: roundHours(payrollRecord.mandatoryRestOvertimeHours ?? 0),
    },
  };
}
