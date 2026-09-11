import { prisma } from '@/lib/database';
import {
  indexApprovedOvertimeRequests,
  resolveAttendanceOvertimeType,
  resolveApprovedAttendanceOvertime,
  type AttendanceOvertimeType,
  type ResolvedApprovedAttendanceOvertime,
} from '@/lib/approved-overtime';
import {
  DEFAULT_OVERTIME_CALCULATION_SETTINGS,
  getStoredOvertimeCalculationSettings,
} from '@/lib/overtime-settings';
import { getTaiwanDayEnd, getTaiwanDayStart, toTaiwanDateStr } from '@/lib/timezone';
import { getStoredOrCalculatedAttendanceHours } from '@/lib/work-hours';

export interface OvertimeEligibilityRequest {
  id: number;
  employeeId: number;
  overtimeDate: Date;
  totalHours: number;
  compensationType?: string | null;
  overtimeType?: string | null;
}

export interface OvertimeEligibilityResult extends ResolvedApprovedAttendanceOvertime {
  hasCompleteAttendance: boolean;
  overtimeType: AttendanceOvertimeType;
}

export interface OvertimeEligibilityDateResult extends OvertimeEligibilityResult {
  employeeId: number;
  workDate: string;
  requestIds: number[];
}

export interface OvertimeEligibilityBatchResult {
  byRequestId: Map<number, OvertimeEligibilityDateResult>;
  byEmployeeDate: Map<string, OvertimeEligibilityDateResult>;
  totalEffectiveHours: number;
}

export async function calculateOvertimeRequestEligibility(
  request: OvertimeEligibilityRequest,
  options?: {
    overtimeType?: AttendanceOvertimeType;
    unitMinutes?: number;
  }
): Promise<OvertimeEligibilityResult> {
  const date = toTaiwanDateStr(request.overtimeDate);
  const [year, month, day] = date.split('-').map(Number);
  const dayStart = getTaiwanDayStart(year, month, day);
  const dayEnd = getTaiwanDayEnd(year, month, day);

  const [attendance, schedule, holiday, settings] = await Promise.all([
    prisma.attendanceRecord.findFirst({
      where: {
        employeeId: request.employeeId,
        workDate: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.schedule.findFirst({
      where: { employeeId: request.employeeId, workDate: date },
    }),
    prisma.holiday.findFirst({
      where: { date: { gte: dayStart, lte: dayEnd }, isActive: true },
    }),
    options?.unitMinutes === undefined
      ? getStoredOvertimeCalculationSettings()
      : Promise.resolve(null),
  ]);

  const scheduledOvertimeType = resolveAttendanceOvertimeType({
    shiftType: schedule?.shiftType,
    workDate: request.overtimeDate,
    isHoliday: Boolean(holiday),
  });
  // 已存在班表或國假資料時，實際日型是法定計算依據；不可讓審核 payload
  // 把平日改標為休息日而繞過每日 8 小時門檻。無班表時才接受人工分類。
  const overtimeType = schedule?.shiftType || holiday
    ? scheduledOvertimeType
    : options?.overtimeType ?? scheduledOvertimeType;
  const hasCompleteAttendance = Boolean(attendance?.clockInTime && attendance?.clockOutTime);
  const hours = hasCompleteAttendance
    ? getStoredOrCalculatedAttendanceHours({
        ...attendance,
        breakTime: schedule?.breakTime,
        scheduledWorkHours: schedule?.workHours,
        scheduledStart: schedule?.startTime,
        scheduledEnd: schedule?.endTime,
      })
    : { totalHours: 0, regularHours: 0, overtimeHours: 0 };

  const resolved = resolveApprovedAttendanceOvertime(
    {
      employeeId: request.employeeId,
      workDate: request.overtimeDate,
      regularHours: hours.regularHours,
      actualWorkHours: hours.totalHours,
      overtimeHours: hours.overtimeHours,
      overtimeType,
    },
    indexApprovedOvertimeRequests([request]),
    options?.unitMinutes
      ?? settings?.overtimeMinUnit
      ?? DEFAULT_OVERTIME_CALCULATION_SETTINGS.overtimeMinUnit
  );

  return { ...resolved, hasCompleteAttendance, overtimeType };
}

const VALID_OVERTIME_TYPES = new Set<AttendanceOvertimeType>([
  'WEEKDAY',
  'REST_DAY',
  'HOLIDAY',
  'MANDATORY_REST',
]);

function normalizeSubmittedOvertimeType(value?: string | null) {
  return value && VALID_OVERTIME_TYPES.has(value as AttendanceOvertimeType)
    ? value as AttendanceOvertimeType
    : undefined;
}

/**
 * 批次解析已核准申請的實際有效時數，供統計、警示與月上限共用。
 * 一次載入出勤、班表、國假與設定，避免逐張申請查詢資料庫。
 */
export async function calculateOvertimeRequestsEligibility(
  requests: OvertimeEligibilityRequest[],
  options?: { unitMinutes?: number }
): Promise<OvertimeEligibilityBatchResult> {
  const byRequestId = new Map<number, OvertimeEligibilityDateResult>();
  const byEmployeeDate = new Map<string, OvertimeEligibilityDateResult>();
  if (requests.length === 0) {
    return { byRequestId, byEmployeeDate, totalEffectiveHours: 0 };
  }

  const dateStrings = requests.map(request => toTaiwanDateStr(request.overtimeDate)).sort();
  const firstDate = dateStrings[0];
  const lastDate = dateStrings[dateStrings.length - 1];
  const [firstYear, firstMonth, firstDay] = firstDate.split('-').map(Number);
  const [lastYear, lastMonth, lastDay] = lastDate.split('-').map(Number);
  const rangeStart = getTaiwanDayStart(firstYear, firstMonth, firstDay);
  const rangeEnd = getTaiwanDayEnd(lastYear, lastMonth, lastDay);
  const employeeIds = [...new Set(requests.map(request => request.employeeId))];

  const [attendanceRecords, schedules, holidays, settings] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: { gte: firstDate, lte: lastDate },
      },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd }, isActive: true },
    }),
    options?.unitMinutes === undefined
      ? getStoredOvertimeCalculationSettings()
      : Promise.resolve(null),
  ]);

  const attendanceByEmployeeDate = new Map(
    attendanceRecords.map(record => [
      `${record.employeeId}-${toTaiwanDateStr(record.workDate)}`,
      record,
    ])
  );
  const scheduleByEmployeeDate = new Map(
    schedules.map(schedule => [`${schedule.employeeId}-${schedule.workDate}`, schedule])
  );
  const holidayDates = new Set(holidays.map(holiday => toTaiwanDateStr(holiday.date)));
  const unitMinutes = options?.unitMinutes
    ?? settings?.overtimeMinUnit
    ?? DEFAULT_OVERTIME_CALCULATION_SETTINGS.overtimeMinUnit;

  const requestsByEmployeeDate = new Map<string, OvertimeEligibilityRequest[]>();
  for (const request of requests) {
    const key = `${request.employeeId}-${toTaiwanDateStr(request.overtimeDate)}`;
    requestsByEmployeeDate.set(key, [...(requestsByEmployeeDate.get(key) || []), request]);
  }

  for (const [key, groupedRequests] of requestsByEmployeeDate) {
    const request = groupedRequests[0];
    const date = toTaiwanDateStr(request.overtimeDate);
    const attendance = attendanceByEmployeeDate.get(key);
    const schedule = scheduleByEmployeeDate.get(key);
    const isHoliday = holidayDates.has(date);
    const scheduledOvertimeType = resolveAttendanceOvertimeType({
      shiftType: schedule?.shiftType,
      workDate: request.overtimeDate,
      isHoliday,
    });
    const overtimeType = schedule?.shiftType || isHoliday
      ? scheduledOvertimeType
      : normalizeSubmittedOvertimeType(request.overtimeType) ?? scheduledOvertimeType;
    const hasCompleteAttendance = Boolean(attendance?.clockInTime && attendance?.clockOutTime);
    const hours = hasCompleteAttendance
      ? getStoredOrCalculatedAttendanceHours({
          ...attendance,
          breakTime: schedule?.breakTime,
          scheduledWorkHours: schedule?.workHours,
          scheduledStart: schedule?.startTime,
          scheduledEnd: schedule?.endTime,
        })
      : { totalHours: 0, regularHours: 0, overtimeHours: 0 };
    const resolved = resolveApprovedAttendanceOvertime(
      {
        employeeId: request.employeeId,
        workDate: request.overtimeDate,
        regularHours: hours.regularHours,
        actualWorkHours: hours.totalHours,
        overtimeHours: hours.overtimeHours,
        overtimeType,
      },
      indexApprovedOvertimeRequests(groupedRequests),
      unitMinutes
    );

    const dateResult: OvertimeEligibilityDateResult = {
      ...resolved,
      hasCompleteAttendance,
      overtimeType,
      employeeId: request.employeeId,
      workDate: date,
      requestIds: groupedRequests.map(item => item.id),
    };
    byEmployeeDate.set(key, dateResult);
    for (const groupedRequest of groupedRequests) {
      byRequestId.set(groupedRequest.id, dateResult);
    }
  }

  const totalEffectiveHours = Math.round(
    [...byEmployeeDate.values()].reduce((sum, result) => sum + result.effectiveHours, 0) * 100
  ) / 100;

  return { byRequestId, byEmployeeDate, totalEffectiveHours };
}

export function getOvertimeEligibilityError(result: OvertimeEligibilityResult) {
  if (!result.hasCompleteAttendance) {
    return '當日上下班打卡不完整，請先完成補卡後再核准加班';
  }
  if (result.effectiveHours <= 0) {
    return '當日實際淨工時未達法定加班門檻，無可核准的加班時數';
  }
  return null;
}
