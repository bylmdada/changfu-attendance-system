export function extractLeaveDatePart(dateTimeValue: string): string {
  const matchedDate = dateTimeValue.match(/^(\d{4}-\d{2}-\d{2})/);
  if (matchedDate) {
    return matchedDate[1];
  }

  const parsedDate = new Date(dateTimeValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatLeaveDisplayDate(dateTimeValue: string): string {
  const datePart = extractLeaveDatePart(dateTimeValue);
  return datePart ? datePart.replace(/-/g, '/') : dateTimeValue;
}

const LEAVE_HOURS_PER_DAY = 8;

export interface LeaveDurationSchedule {
  shiftType?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  breakTime?: number | null;
  workHours?: number | null;
}

export type LeaveDurationScheduleMap = Record<string, LeaveDurationSchedule | undefined>;

function formatLeaveAmount(value: number, fractionDigits: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return value
    .toFixed(fractionDigits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

export function deriveLeaveHours(totalDays: number): number {
  if (!Number.isFinite(totalDays) || totalDays <= 0) {
    return 0;
  }

  return Math.round(totalDays * LEAVE_HOURS_PER_DAY * 100) / 100;
}

export function formatLeaveDays(totalDays: number): string {
  return `${formatLeaveAmount(totalDays, 4)} 天`;
}

export function formatLeaveHours(totalHours: number): string {
  return `${formatLeaveAmount(totalHours, 2)} 小時`;
}

export function formatLeaveDurationSummary(totalHours: number): string {
  if (!Number.isFinite(totalHours) || totalHours <= 0) {
    return '0 小時';
  }

  const wholeDays = Math.floor(totalHours / LEAVE_HOURS_PER_DAY);
  const remainingHours = Math.round((totalHours - wholeDays * LEAVE_HOURS_PER_DAY) * 100) / 100;
  const parts: string[] = [];

  if (wholeDays > 0) {
    parts.push(`${wholeDays} 天`);
  }

  if (remainingHours > 0 || parts.length === 0) {
    parts.push(formatLeaveHours(remainingHours));
  }

  return parts.join(' ');
}

export function leaveRangesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}

function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;

  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function parseDateToDayIndex(date: string): number | null {
  const matchedDate = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) return null;

  const [, yearText, monthText, dayText] = matchedDate;
  const dayIndex = Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)) / 86400000;
  return Number.isFinite(dayIndex) ? dayIndex : null;
}

function formatDayIndex(dayIndex: number): string {
  return new Date(dayIndex * 86400000).toISOString().slice(0, 10);
}

function getOverlappedMinutes(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function getScheduleBreakMinutes(schedule: LeaveDurationSchedule, scheduledMinutes: number): number {
  const explicitBreak = typeof schedule.breakTime === 'number' && Number.isFinite(schedule.breakTime)
    ? Math.max(0, schedule.breakTime)
    : 0;
  if (explicitBreak > 0) {
    return Math.min(explicitBreak, scheduledMinutes);
  }

  const workHours = typeof schedule.workHours === 'number' && Number.isFinite(schedule.workHours)
    ? Math.max(0, schedule.workHours)
    : 0;
  const impliedBreak = scheduledMinutes - workHours * 60;
  return impliedBreak > 0 ? Math.min(impliedBreak, scheduledMinutes) : 0;
}

function calculateScheduledLeaveMinutes(
  leaveStartMinute: number,
  leaveEndMinute: number,
  schedule: LeaveDurationSchedule
): number | null {
  const scheduleStartMinute = parseTimeToMinutes(schedule.startTime);
  const rawScheduleEndMinute = parseTimeToMinutes(schedule.endTime);
  if (scheduleStartMinute === null || rawScheduleEndMinute === null) {
    return null;
  }

  const scheduleEndMinute = rawScheduleEndMinute <= scheduleStartMinute
    ? rawScheduleEndMinute + 24 * 60
    : rawScheduleEndMinute;
  const scheduledMinutes = Math.max(0, scheduleEndMinute - scheduleStartMinute);
  if (scheduledMinutes <= 0) {
    return 0;
  }

  const leaveMinutesInsideShift = getOverlappedMinutes(
    leaveStartMinute,
    leaveEndMinute,
    scheduleStartMinute,
    scheduleEndMinute
  );
  if (leaveMinutesInsideShift <= 0) {
    return 0;
  }

  const breakMinutes = getScheduleBreakMinutes(schedule, scheduledMinutes);
  if (breakMinutes <= 0) {
    return leaveMinutesInsideShift;
  }

  // 班表目前只記錄休息總分鐘數，沒有休息起訖。用班別中段推算休息區間，
  // 可正確處理 08:00-17:00 / 休息 60 分鐘這類標準班別。
  const breakStartMinute = scheduleStartMinute + Math.floor((scheduledMinutes - breakMinutes) / 2);
  const breakEndMinute = breakStartMinute + breakMinutes;
  const leaveBreakOverlap = getOverlappedMinutes(
    leaveStartMinute,
    leaveEndMinute,
    breakStartMinute,
    breakEndMinute
  );

  return Math.max(0, leaveMinutesInsideShift - leaveBreakOverlap);
}

export function calculateLeaveHoursByDate(range: {
  startDate: string;
  endDate: string;
  startHour: string;
  startMinute: string;
  endHour: string;
  endMinute: string;
}, schedulesByDate: LeaveDurationScheduleMap = {}): Record<string, number> | null {
  if (
    !range.startDate
    || !range.endDate
    || !range.startHour
    || !range.startMinute
    || !range.endHour
    || !range.endMinute
  ) {
    return null;
  }

  const startDayIndex = parseDateToDayIndex(range.startDate);
  const endDayIndex = parseDateToDayIndex(range.endDate);
  const startMinuteOfDay = parseTimeToMinutes(`${range.startHour.padStart(2, '0')}:${range.startMinute.padStart(2, '0')}`);
  const endMinuteOfDay = parseTimeToMinutes(`${range.endHour.padStart(2, '0')}:${range.endMinute.padStart(2, '0')}`);

  if (
    startDayIndex === null
    || endDayIndex === null
    || startMinuteOfDay === null
    || endMinuteOfDay === null
    || endDayIndex < startDayIndex
  ) {
    return null;
  }

  const absoluteStartMinute = startDayIndex * 24 * 60 + startMinuteOfDay;
  const absoluteEndMinute = endDayIndex * 24 * 60 + endMinuteOfDay;
  if (absoluteEndMinute <= absoluteStartMinute) {
    return null;
  }

  const hoursByDate: Record<string, number> = {};
  for (let dayIndex = startDayIndex; dayIndex <= endDayIndex; dayIndex += 1) {
    const date = formatDayIndex(dayIndex);
    const dayStartMinute = dayIndex === startDayIndex ? startMinuteOfDay : 0;
    const dayEndMinute = dayIndex === endDayIndex ? endMinuteOfDay : 24 * 60;
    const schedule = schedulesByDate[date];
    const scheduledLeaveMinutes = schedule
      ? calculateScheduledLeaveMinutes(dayStartMinute, dayEndMinute, schedule)
      : null;

    const minutes = scheduledLeaveMinutes ?? Math.max(0, dayEndMinute - dayStartMinute);
    if (minutes > 0) {
      hoursByDate[date] = Math.round((minutes / 60) * 100) / 100;
    }
  }

  return Object.keys(hoursByDate).length > 0 ? hoursByDate : null;
}

export function calculateLeaveDuration(range: {
  startDate: string;
  endDate: string;
  startHour: string;
  startMinute: string;
  endHour: string;
  endMinute: string;
}, schedulesByDate: LeaveDurationScheduleMap = {}): { totalDays: number; totalHours: number } | null {
  const hoursByDate = calculateLeaveHoursByDate(range, schedulesByDate);
  if (!hoursByDate) return null;

  const totalHours = Math.round(
    Object.values(hoursByDate).reduce((sum, hours) => sum + hours, 0) * 100
  ) / 100;
  if (totalHours <= 0) {
    return null;
  }

  return {
    totalHours,
    totalDays: totalHours / LEAVE_HOURS_PER_DAY,
  };
}

export function getLeaveStatusSortOrder(status: string): number {
  switch (status) {
    case 'PENDING':
      return 0;
    case 'PENDING_ADMIN':
      return 1;
    case 'APPROVED':
      return 2;
    case 'REJECTED':
      return 3;
    case 'CANCELLED':
      return 4;
    case 'VOIDED':
      return 5;
    default:
      return 99;
  }
}

export function buildLeaveReviewRequestBody(
  status: 'APPROVED' | 'REJECTED',
  options: { canFinalApprove: boolean; canSubmitManagerOpinion: boolean }
): { status: 'APPROVED' | 'REJECTED' } | { opinion: 'AGREE' | 'DISAGREE' } {
  if (!options.canFinalApprove && options.canSubmitManagerOpinion) {
    return { opinion: status === 'APPROVED' ? 'AGREE' : 'DISAGREE' };
  }

  return { status };
}
