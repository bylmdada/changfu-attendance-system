import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

export type ClockTimeRestrictionSettings = {
  enabled: boolean;
  restrictedStartHour: number;
  restrictedEndHour: number;
  message: string;
};

export const DEFAULT_CLOCK_TIME_RESTRICTION_SETTINGS: ClockTimeRestrictionSettings = {
  enabled: true,
  restrictedStartHour: 23,
  restrictedEndHour: 5,
  message: '夜間時段暫停打卡服務',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStoredHourValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsedValue = Number(value.trim());
    if (parsedValue >= 0 && parsedValue <= 23) {
      return parsedValue;
    }
  }

  return fallback;
}

export function normalizeClockTimeRestrictionSettings(value: unknown): ClockTimeRestrictionSettings {
  if (!isPlainObject(value)) {
    return { ...DEFAULT_CLOCK_TIME_RESTRICTION_SETTINGS };
  }

  return {
    enabled: typeof value.enabled === 'boolean'
      ? value.enabled
      : DEFAULT_CLOCK_TIME_RESTRICTION_SETTINGS.enabled,
    restrictedStartHour: parseStoredHourValue(
      value.restrictedStartHour,
      DEFAULT_CLOCK_TIME_RESTRICTION_SETTINGS.restrictedStartHour
    ),
    restrictedEndHour: parseStoredHourValue(
      value.restrictedEndHour,
      DEFAULT_CLOCK_TIME_RESTRICTION_SETTINGS.restrictedEndHour
    ),
    message: typeof value.message === 'string' && value.message.trim().length > 0
      ? value.message.trim()
      : DEFAULT_CLOCK_TIME_RESTRICTION_SETTINGS.message,
  };
}

export function parseClockTimeRestrictionSettings(
  rawValue: string | null | undefined
): ClockTimeRestrictionSettings {
  const parsed = safeParseSystemSettingsValue<unknown>(
    rawValue,
    null,
    'clock_time_restriction'
  );

  return normalizeClockTimeRestrictionSettings(parsed);
}

export function isClockTimeRestricted(currentHour: number, settings: ClockTimeRestrictionSettings): boolean {
  const startHour = settings.restrictedStartHour;
  const endHour = settings.restrictedEndHour;

  if (startHour > endHour) {
    return currentHour >= startHour || currentHour < endHour;
  }

  if (startHour < endHour) {
    return currentHour >= startHour && currentHour < endHour;
  }

  return false;
}
