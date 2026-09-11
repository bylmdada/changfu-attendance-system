import { prisma } from '@/lib/database';
import { normalizeOvertimeUnitMinutes } from '@/lib/overtime-hours';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

export type OvertimeCompensationMode =
  | 'COMP_LEAVE_ONLY'
  | 'OVERTIME_PAY_ONLY'
  | 'EMPLOYEE_CHOICE';

export interface OvertimeCalculationSettings {
  weekdayFirstTwoHoursRate: number;
  weekdayAfterTwoHoursRate: number;
  restDayFirstTwoHoursRate: number;
  restDayHours3To8Rate: number;
  restDayAfterEightHoursRate: number;
  holidayRate: number;
  mandatoryRestRate: number;
  weekdayMaxHours: number;
  restDayMaxHours: number;
  holidayMaxHours: number;
  mandatoryRestMaxHours: number;
  monthlyBasicHours: number;
  restDayMinimumPayHours: number;
  overtimeMinUnit: number;
  compensationMode: OvertimeCompensationMode;
  settleOnResignation: boolean;
  isEnabled: boolean;
  description: string;
}

export const OVERTIME_SETTINGS_KEY = 'overtime_calculation_settings';

export const DEFAULT_OVERTIME_CALCULATION_SETTINGS: OvertimeCalculationSettings = {
  weekdayFirstTwoHoursRate: 1.34,
  weekdayAfterTwoHoursRate: 1.67,
  restDayFirstTwoHoursRate: 4 / 3,
  restDayHours3To8Rate: 5 / 3,
  restDayAfterEightHoursRate: 8 / 3,
  holidayRate: 2.0,
  mandatoryRestRate: 2.0,
  weekdayMaxHours: 4,
  restDayMaxHours: 12,
  holidayMaxHours: 8,
  mandatoryRestMaxHours: 8,
  monthlyBasicHours: 240,
  restDayMinimumPayHours: 4,
  overtimeMinUnit: 30,
  compensationMode: 'COMP_LEAVE_ONLY',
  settleOnResignation: true,
  isEnabled: true,
  description: '依據勞動基準法設定之加班費計算倍率',
};

export function normalizeOvertimeCalculationSettings(
  settings?: Partial<OvertimeCalculationSettings> | null
): OvertimeCalculationSettings {
  const sanitizedSettings = { ...(settings ?? {}) } as Partial<OvertimeCalculationSettings> & {
    restDayFirstEightHoursRate?: number;
  };
  delete sanitizedSettings.restDayFirstEightHoursRate;
  delete sanitizedSettings.restDayFirstTwoHoursRate;
  delete sanitizedSettings.restDayHours3To8Rate;
  delete sanitizedSettings.restDayAfterEightHoursRate;

  return {
    ...DEFAULT_OVERTIME_CALCULATION_SETTINGS,
    ...sanitizedSettings,
    restDayFirstTwoHoursRate: DEFAULT_OVERTIME_CALCULATION_SETTINGS.restDayFirstTwoHoursRate,
    restDayHours3To8Rate: DEFAULT_OVERTIME_CALCULATION_SETTINGS.restDayHours3To8Rate,
    restDayAfterEightHoursRate: DEFAULT_OVERTIME_CALCULATION_SETTINGS.restDayAfterEightHoursRate,
    overtimeMinUnit: normalizeOvertimeUnitMinutes(sanitizedSettings.overtimeMinUnit),
  };
}

export async function getStoredOvertimeCalculationSettings(): Promise<OvertimeCalculationSettings> {
  const settingModel = (prisma as unknown as {
    systemSettings?: {
      findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>;
    };
  }).systemSettings;

  if (!settingModel?.findUnique) {
    return { ...DEFAULT_OVERTIME_CALCULATION_SETTINGS };
  }

  const setting = await settingModel.findUnique({
    where: { key: OVERTIME_SETTINGS_KEY },
  });

  if (!setting) {
    return { ...DEFAULT_OVERTIME_CALCULATION_SETTINGS };
  }

  return normalizeOvertimeCalculationSettings(
    safeParseSystemSettingsValue<Partial<OvertimeCalculationSettings>>(
      setting.value,
      {},
      OVERTIME_SETTINGS_KEY
    )
  );
}
