import { getTaiwanDateParts, getTaiwanTimeParts } from '@/lib/timezone';

export const STANDARD_REGULAR_HOURS = 8;

type DateLike = Date | string | null | undefined;
type RegularTimeExclusion = {
  startTime?: DateLike;
  endTime?: DateLike;
};
type ScheduleWindow = {
  startTime?: string | null;
  endTime?: string | null;
  workDate?: DateLike;
  regularTimeExclusions?: RegularTimeExclusion[];
};

type ScheduleTimingResult = {
  isLate: boolean;
  isEarly: boolean;
  lateMinutes: number;
  earlyLeaveMinutes: number;
};

function toDate(value: DateLike): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value instanceof Date ? value : new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

function parseTimeToMinutes(time?: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((time || '').trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
}

function getOverlapMinutes(startA: number, endA: number, startB: number, endB: number) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function getExcludedMinutes(
  start: number,
  end: number,
  exclusions: RegularTimeExclusion[] = [],
  absoluteIntervals: Array<{ start: number; end: number }> = []
) {
  const intervals = [
    ...absoluteIntervals,
    ...exclusions
    .map((exclusion) => {
      const exclusionStart = toDate(exclusion.startTime);
      const exclusionEnd = toDate(exclusion.endTime);
      if (!exclusionStart || !exclusionEnd) return null;

      const clippedStart = Math.max(start, getTaiwanAbsoluteMinutes(exclusionStart));
      const clippedEnd = Math.min(end, getTaiwanAbsoluteMinutes(exclusionEnd));
      return clippedEnd > clippedStart ? { start: clippedStart, end: clippedEnd } : null;
    })
    .filter((interval): interval is { start: number; end: number } => Boolean(interval)),
  ]
    .map((interval) => ({
      start: Math.max(start, interval.start),
      end: Math.min(end, interval.end),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  let excludedMinutes = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  for (const interval of intervals) {
    if (currentStart === null || currentEnd === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
    } else if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      excludedMinutes += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }

  return excludedMinutes + (
    currentStart !== null && currentEnd !== null ? currentEnd - currentStart : 0
  );
}

function getTaiwanAbsoluteMinutes(date: Date) {
  const day = getTaiwanDateParts(date);
  const time = getTaiwanTimeParts(date);
  const dayIndex = Date.UTC(day.year, day.month - 1, day.day) / 86400000;
  return dayIndex * 24 * 60 + time.hour * 60 + time.minute;
}

function getScheduleAbsoluteWindow(schedule?: ScheduleWindow, fallbackAnchor?: Date) {
  const scheduleStartMinute = parseTimeToMinutes(schedule?.startTime);
  const scheduleEndMinute = parseTimeToMinutes(schedule?.endTime);
  if (scheduleStartMinute === null || scheduleEndMinute === null) {
    return null;
  }

  const scheduleAnchor = toDate(schedule?.workDate) || fallbackAnchor;
  if (!scheduleAnchor) {
    return null;
  }

  const scheduleDayStart = Math.floor(getTaiwanAbsoluteMinutes(scheduleAnchor) / (24 * 60)) * 24 * 60;
  return {
    start: scheduleDayStart + scheduleStartMinute,
    end: scheduleDayStart + scheduleEndMinute + (scheduleEndMinute <= scheduleStartMinute ? 24 * 60 : 0),
  };
}

export function getScheduledAttendanceTiming(params: {
  clockInTime?: DateLike;
  clockOutTime?: DateLike;
  schedule?: ScheduleWindow;
  workHours?: number;
  breakMinutes?: number;
}): ScheduleTimingResult {
  const clockIn = toDate(params.clockInTime);
  const clockOut = toDate(params.clockOutTime);
  const window = getScheduleAbsoluteWindow(params.schedule, clockIn || clockOut || undefined);
  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;

  if (!window) {
    return { isLate: false, isEarly: false, lateMinutes, earlyLeaveMinutes };
  }

  if (clockIn) {
    lateMinutes = Math.max(0, getTaiwanAbsoluteMinutes(clockIn) - window.start);
  }

  if (clockOut) {
    earlyLeaveMinutes = Math.max(0, window.end - getTaiwanAbsoluteMinutes(clockOut));
  }

  if (params.workHours !== undefined || params.schedule?.regularTimeExclusions) {
    const breakMinutes = params.breakMinutes ?? Math.max(0, window.end - window.start - (params.workHours ?? 0) * 60);
    const payableMinutes = (start: number, end: number) => Math.max(0,
      end - start - getRegularUnavailableMinutes(start, end, window.start, window.end,
        params.workHours === undefined && params.breakMinutes === undefined ? 0 : breakMinutes,
        params.schedule?.regularTimeExclusions)
    );
    if (clockIn) lateMinutes = payableMinutes(window.start, Math.min(window.end, Math.max(window.start, getTaiwanAbsoluteMinutes(clockIn))));
    if (clockOut) earlyLeaveMinutes = payableMinutes(Math.max(window.start, Math.min(window.end, getTaiwanAbsoluteMinutes(clockOut))), window.end);
  }

  return {
    isLate: lateMinutes > 0,
    isEarly: earlyLeaveMinutes > 0,
    lateMinutes,
    earlyLeaveMinutes,
  };
}

function getBreakOverlapMinutes(
  start: number,
  end: number,
  scheduleStart: number,
  scheduleEnd: number,
  breakMinutes: number
) {
  const scheduledMinutes = Math.max(0, scheduleEnd - scheduleStart);
  const clampedBreakMinutes = Math.min(Math.max(0, breakMinutes), scheduledMinutes);
  if (clampedBreakMinutes <= 0) return 0;

  const breakStart = scheduleStart + Math.floor((scheduledMinutes - clampedBreakMinutes) / 2);
  return getOverlapMinutes(start, end, breakStart, breakStart + clampedBreakMinutes);
}

function getRegularUnavailableMinutes(
  start: number,
  end: number,
  scheduleStart: number,
  scheduleEnd: number,
  breakMinutes: number,
  exclusions: RegularTimeExclusion[] = []
) {
  const scheduledMinutes = Math.max(0, scheduleEnd - scheduleStart);
  const clampedBreakMinutes = Math.min(Math.max(0, breakMinutes), scheduledMinutes);
  const breakStart = scheduleStart + Math.floor((scheduledMinutes - clampedBreakMinutes) / 2);
  const breakIntervals = clampedBreakMinutes > 0
    ? [{ start: breakStart, end: breakStart + clampedBreakMinutes }]
    : [];

  return getExcludedMinutes(start, end, exclusions, breakIntervals);
}

export function calculateAttendanceHours(
  clockInTime: DateLike,
  clockOutTime: DateLike,
  standardHours = STANDARD_REGULAR_HOURS,
  breakMinutes = 0,
  schedule?: ScheduleWindow
) {
  const clockIn = toDate(clockInTime);
  const clockOut = toDate(clockOutTime);

  if (!clockIn || !clockOut) {
    return {
      totalHours: 0,
      regularHours: 0,
      overtimeHours: 0,
    };
  }

  let rawMinutes = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / (1000 * 60));
  let regularMinutes = rawMinutes;
  const scheduleStartMinute = parseTimeToMinutes(schedule?.startTime);
  const scheduleEndMinute = parseTimeToMinutes(schedule?.endTime);

  if (scheduleStartMinute !== null && scheduleEndMinute !== null) {
    const clockInAbsoluteMinute = getTaiwanAbsoluteMinutes(clockIn);
    const clockOutAbsoluteMinute = getTaiwanAbsoluteMinutes(clockOut);
    const scheduleWindow = getScheduleAbsoluteWindow(schedule, clockIn);
    const scheduleStart = scheduleWindow?.start ?? clockInAbsoluteMinute;
    const scheduleEnd = scheduleWindow?.end ?? clockOutAbsoluteMinute;
    const overlappedStart = Math.max(clockInAbsoluteMinute, scheduleStart);
    const overlappedEnd = Math.min(clockOutAbsoluteMinute, scheduleEnd);

    rawMinutes = Math.max(0, clockOutAbsoluteMinute - clockInAbsoluteMinute)
      - getBreakOverlapMinutes(clockInAbsoluteMinute, clockOutAbsoluteMinute, scheduleStart, scheduleEnd, breakMinutes);
    regularMinutes = getOverlapMinutes(clockInAbsoluteMinute, clockOutAbsoluteMinute, scheduleStart, scheduleEnd)
      - getRegularUnavailableMinutes(
          overlappedStart,
          overlappedEnd,
          scheduleStart,
          scheduleEnd,
          breakMinutes,
          schedule?.regularTimeExclusions
        );
  } else {
    rawMinutes = Math.max(0, rawMinutes - Math.max(0, breakMinutes));
  }

  const rawHours = Math.max(0, rawMinutes) / 60;
  const hasScheduleWindow = scheduleStartMinute !== null && scheduleEndMinute !== null;
  const regularHourLimit = hasScheduleWindow ? STANDARD_REGULAR_HOURS : standardHours;
  const regularHours = Math.min(Math.max(0, regularMinutes) / 60, regularHourLimit);
  // 平日延長工時以「實際淨工時超過每日法定 8 小時」為門檻。
  // 班表工時可能因遲到、短班或休假少於 8 小時，不能拿班表工時當加班門檻。
  const overtimeHours = Math.max(0, rawHours - STANDARD_REGULAR_HOURS);

  return {
    totalHours: roundHours(rawHours),
    regularHours: roundHours(regularHours),
    overtimeHours: roundHours(overtimeHours),
  };
}

export function getStoredOrCalculatedAttendanceHours(record: {
  clockInTime?: DateLike;
  clockOutTime?: DateLike;
  regularHours?: number | null;
  overtimeHours?: number | null;
  breakTime?: number | null;
  workDate?: DateLike;
  scheduledWorkHours?: number | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  regularTimeExclusions?: RegularTimeExclusion[];
}) {
  const hasClockTimes = Boolean(record.clockInTime && record.clockOutTime);

  if (!hasClockTimes && (record.regularHours != null || record.overtimeHours != null)) {
    const regularHours = roundHours(record.regularHours || 0);
    const overtimeHours = roundHours(record.overtimeHours || 0);

    return {
      totalHours: roundHours(regularHours + overtimeHours),
      regularHours,
      overtimeHours,
    };
  }

  return calculateAttendanceHours(
    record.clockInTime,
    record.clockOutTime,
    record.scheduledWorkHours ?? STANDARD_REGULAR_HOURS,
    record.breakTime || 0,
    {
      startTime: record.scheduledStart,
      endTime: record.scheduledEnd,
      workDate: record.workDate,
      regularTimeExclusions: record.regularTimeExclusions,
    }
  );
}
