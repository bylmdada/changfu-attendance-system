export interface ClockReasonPromptSettings {
  enabled: boolean;
  earlyClockInThreshold: number;
  lateClockOutThreshold: number;
  excludeHolidays: boolean;
  excludeApprovedOvertime: boolean;
}

export interface ClockReasonPromptData {
  type: 'EARLY_IN' | 'LATE_OUT';
  minutesDiff: number;
  scheduledTime: string;
  recordId: number;
}

export const DEFAULT_CLOCK_REASON_PROMPT_SETTINGS: ClockReasonPromptSettings = {
  enabled: false,
  earlyClockInThreshold: 5,
  lateClockOutThreshold: 5,
  excludeHolidays: true,
  excludeApprovedOvertime: true,
};

function normalizeThreshold(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 120) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsedValue = Number(value.trim());
    if (parsedValue >= 1 && parsedValue <= 120) {
      return parsedValue;
    }
  }

  return fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeClockReasonPromptSettings(value: unknown): ClockReasonPromptSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_CLOCK_REASON_PROMPT_SETTINGS };
  }

  const record = value as Record<string, unknown>;

  return {
    enabled: normalizeBoolean(record.enabled, DEFAULT_CLOCK_REASON_PROMPT_SETTINGS.enabled),
    earlyClockInThreshold: normalizeThreshold(
      record.earlyClockInThreshold,
      DEFAULT_CLOCK_REASON_PROMPT_SETTINGS.earlyClockInThreshold
    ),
    lateClockOutThreshold: normalizeThreshold(
      record.lateClockOutThreshold,
      DEFAULT_CLOCK_REASON_PROMPT_SETTINGS.lateClockOutThreshold
    ),
    excludeHolidays: normalizeBoolean(
      record.excludeHolidays,
      DEFAULT_CLOCK_REASON_PROMPT_SETTINGS.excludeHolidays
    ),
    excludeApprovedOvertime: normalizeBoolean(
      record.excludeApprovedOvertime,
      DEFAULT_CLOCK_REASON_PROMPT_SETTINGS.excludeApprovedOvertime
    ),
  };
}

export function parseClockReasonPromptSettings(rawValue: unknown): ClockReasonPromptSettings {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return { ...DEFAULT_CLOCK_REASON_PROMPT_SETTINGS };
  }

  try {
    return normalizeClockReasonPromptSettings(JSON.parse(rawValue));
  } catch (error) {
    console.warn('Failed to parse clock reason prompt settings:', error);
    return { ...DEFAULT_CLOCK_REASON_PROMPT_SETTINGS };
  }
}

export function parseTimeStringToMinutes(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

export function formatMinutesAsTime(totalMinutes: number): string {
  const normalizedMinutes = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function shouldSkipClockReasonPrompt({
  settings,
  isHoliday,
  isRestDay,
  hasApprovedOvertime,
}: {
  settings: ClockReasonPromptSettings;
  isHoliday: boolean;
  isRestDay: boolean;
  hasApprovedOvertime: boolean;
}): boolean {
  if (!settings.enabled) {
    return true;
  }

  if (settings.excludeHolidays && (isHoliday || isRestDay)) {
    return true;
  }

  if (settings.excludeApprovedOvertime && hasApprovedOvertime) {
    return true;
  }

  return false;
}

export function buildClockReasonPromptData({
  settings,
  type,
  scheduledTime,
  actualTime,
  recordId,
}: {
  settings: ClockReasonPromptSettings;
  type: 'EARLY_IN' | 'LATE_OUT';
  scheduledTime: string;
  actualTime: string;
  recordId: number;
}): ClockReasonPromptData | null {
  if (!settings.enabled || !Number.isInteger(recordId)) {
    return null;
  }

  const scheduledMinutes = parseTimeStringToMinutes(scheduledTime);
  const actualMinutes = parseTimeStringToMinutes(actualTime);

  if (scheduledMinutes === null || actualMinutes === null) {
    return null;
  }

  const minutesDiff = type === 'EARLY_IN'
    ? scheduledMinutes - actualMinutes
    : actualMinutes - scheduledMinutes;
  const threshold = type === 'EARLY_IN'
    ? settings.earlyClockInThreshold
    : settings.lateClockOutThreshold;

  if (minutesDiff < threshold) {
    return null;
  }

  return {
    type,
    minutesDiff: Math.floor(minutesDiff),
    scheduledTime: formatMinutesAsTime(scheduledMinutes),
    recordId,
  };
}
