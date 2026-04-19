import { toTaiwanDate } from '@/lib/timezone';

export interface AttendanceFreezeSettings {
  freezeDay: number;
  freezeTime: string;
  isEnabled: boolean;
  description: string;
}

export const DEFAULT_ATTENDANCE_FREEZE_SETTINGS: AttendanceFreezeSettings = {
  freezeDay: 5,
  freezeTime: '18:00',
  isEnabled: true,
  description: '每月5日下午6點後，前一個月的考勤記錄將被凍結，無法修改。',
};

function getClampedDay(year: number, monthIndex: number, freezeDay: number): number {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(freezeDay, lastDayOfMonth);
}

function parseFreezeTime(freezeTime: string): { hours: number; minutes: number } {
  const [hours, minutes] = freezeTime.split(':').map(Number);
  return { hours, minutes };
}

export function getFreezeExecutionDateForTargetMonth(
  targetDate: Date,
  settings: AttendanceFreezeSettings
): Date {
  const taiwanTargetDate = toTaiwanDate(targetDate);
  const targetYear = taiwanTargetDate.getFullYear();
  const targetMonthIndex = taiwanTargetDate.getMonth();
  const executionYear = targetMonthIndex === 11 ? targetYear + 1 : targetYear;
  const executionMonthIndex = targetMonthIndex === 11 ? 0 : targetMonthIndex + 1;
  const { hours, minutes } = parseFreezeTime(settings.freezeTime);
  const executionDay = getClampedDay(executionYear, executionMonthIndex, settings.freezeDay);

  return new Date(Date.UTC(executionYear, executionMonthIndex, executionDay, hours - 8, minutes, 0, 0));
}

export function isAttendanceFrozenBySettings(
  targetDate: Date,
  settings: AttendanceFreezeSettings,
  now: Date = new Date()
): boolean {
  if (!settings.isEnabled) {
    return false;
  }

  return now >= getFreezeExecutionDateForTargetMonth(targetDate, settings);
}

export function getNextAttendanceFreezeExecutionDate(
  settings: AttendanceFreezeSettings,
  now: Date = new Date()
): Date | null {
  if (!settings.isEnabled) {
    return null;
  }

  const taiwanNow = toTaiwanDate(now);
  const thisMonthsExecution = getFreezeExecutionDateForTargetMonth(
    new Date(taiwanNow.getFullYear(), taiwanNow.getMonth() - 1, 1),
    settings
  );

  if (now < thisMonthsExecution) {
    return thisMonthsExecution;
  }

  return getFreezeExecutionDateForTargetMonth(
    new Date(taiwanNow.getFullYear(), taiwanNow.getMonth(), 1),
    settings
  );
}
