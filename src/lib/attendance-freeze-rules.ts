import { toTaiwanDate } from '@/lib/timezone';

export interface AttendanceFreezeSettings {
  freezeDay: number;
  freezeTime: string;
  isEnabled: boolean;
  description: string;
}

export function getAttendanceFreezeDescription(freezeDay: number, freezeTime: string): string {
  const { hours, minutes } = parseFreezeTime(freezeTime);
  const period = hours < 12 ? '上午' : '下午';
  const displayHour = hours % 12 || 12;
  const minuteText = minutes > 0 ? `${minutes}分` : '';
  return `每月${freezeDay}日${period}${displayHour}點${minuteText}後，前一個月的考勤記錄將被凍結，無法修改。`;
}

export const DEFAULT_ATTENDANCE_FREEZE_SETTINGS: AttendanceFreezeSettings = {
  freezeDay: 5,
  freezeTime: '18:00',
  isEnabled: true,
  description: getAttendanceFreezeDescription(5, '18:00'),
};

function getClampedDay(year: number, monthIndex: number, freezeDay: number): number {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(freezeDay, lastDayOfMonth);
}

function parseFreezeTime(freezeTime: string): { hours: number; minutes: number } {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(freezeTime);
  if (!match) {
    console.error(`考勤凍結時間格式錯誤：${freezeTime}，改用預設 18:00`);
    return { hours: 18, minutes: 0 };
  }

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
