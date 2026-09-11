import { prisma } from '@/lib/database';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

export interface AttendanceSalaryDeductionSettings {
  enabled: boolean;
  description: string;
}

export const ATTENDANCE_SALARY_DEDUCTION_SETTINGS_KEY = 'attendance_salary_deduction_settings';

export const DEFAULT_ATTENDANCE_SALARY_DEDUCTION_SETTINGS: AttendanceSalaryDeductionSettings = {
  enabled: false,
  description: '控制新薪資試算與薪資生成是否將當月遲到、早退、遲到+早退、缺勤納入扣薪，並同步顯示於薪資條扣除項目與計算備註',
};

export function normalizeAttendanceSalaryDeductionSettings(
  settings?: Partial<AttendanceSalaryDeductionSettings> | null
): AttendanceSalaryDeductionSettings {
  return {
    ...DEFAULT_ATTENDANCE_SALARY_DEDUCTION_SETTINGS,
    ...(settings ?? {}),
    enabled:
      typeof settings?.enabled === 'boolean'
        ? settings.enabled
        : DEFAULT_ATTENDANCE_SALARY_DEDUCTION_SETTINGS.enabled,
    description:
      typeof settings?.description === 'string' && settings.description.trim().length > 0
        ? settings.description.slice(0, 240)
        : DEFAULT_ATTENDANCE_SALARY_DEDUCTION_SETTINGS.description,
  };
}

export async function getStoredAttendanceSalaryDeductionSettings(): Promise<AttendanceSalaryDeductionSettings> {
  const settingModel = (prisma as unknown as {
    systemSettings?: {
      findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>;
    };
  }).systemSettings;

  if (!settingModel?.findUnique) {
    return { ...DEFAULT_ATTENDANCE_SALARY_DEDUCTION_SETTINGS };
  }

  const setting = await settingModel.findUnique({
    where: { key: ATTENDANCE_SALARY_DEDUCTION_SETTINGS_KEY },
  });

  if (!setting) {
    return { ...DEFAULT_ATTENDANCE_SALARY_DEDUCTION_SETTINGS };
  }

  return normalizeAttendanceSalaryDeductionSettings(
    safeParseSystemSettingsValue<Partial<AttendanceSalaryDeductionSettings>>(
      setting.value,
      {},
      ATTENDANCE_SALARY_DEDUCTION_SETTINGS_KEY
    )
  );
}
