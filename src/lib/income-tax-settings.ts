import { prisma } from '@/lib/database';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

export interface IncomeTaxManagementSettings {
  withholdingEnabled: boolean;
  description: string;
}

export interface PayrollIncomeTaxDisplayAmounts {
  incomeTax: number;
  totalDeductions: number;
  netPay: number;
}

export const INCOME_TAX_MANAGEMENT_SETTINGS_KEY = 'income_tax_management_settings';

export const DEFAULT_INCOME_TAX_MANAGEMENT_SETTINGS: IncomeTaxManagementSettings = {
  withholdingEnabled: true,
  description: '控制新薪資試算與薪資生成是否計入所得稅，並同步決定報表管理與薪資管理中的薪資條是否顯示所得稅扣除項目',
};

export function normalizeIncomeTaxManagementSettings(
  settings?: Partial<IncomeTaxManagementSettings> | null
): IncomeTaxManagementSettings {
  return {
    ...DEFAULT_INCOME_TAX_MANAGEMENT_SETTINGS,
    ...(settings ?? {}),
    withholdingEnabled:
      typeof settings?.withholdingEnabled === 'boolean'
        ? settings.withholdingEnabled
        : DEFAULT_INCOME_TAX_MANAGEMENT_SETTINGS.withholdingEnabled,
    description:
      typeof settings?.description === 'string' && settings.description.trim().length > 0
        ? settings.description.slice(0, 200)
        : DEFAULT_INCOME_TAX_MANAGEMENT_SETTINGS.description,
  };
}

export async function getStoredIncomeTaxManagementSettings(): Promise<IncomeTaxManagementSettings> {
  const settingModel = (prisma as unknown as {
    systemSettings?: {
      findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>;
    };
  }).systemSettings;

  if (!settingModel?.findUnique) {
    return { ...DEFAULT_INCOME_TAX_MANAGEMENT_SETTINGS };
  }

  const setting = await settingModel.findUnique({
    where: { key: INCOME_TAX_MANAGEMENT_SETTINGS_KEY },
  });

  if (!setting) {
    return { ...DEFAULT_INCOME_TAX_MANAGEMENT_SETTINGS };
  }

  return normalizeIncomeTaxManagementSettings(
    safeParseSystemSettingsValue<Partial<IncomeTaxManagementSettings>>(
      setting.value,
      {},
      INCOME_TAX_MANAGEMENT_SETTINGS_KEY
    )
  );
}

export function resolvePayrollIncomeTaxDisplayAmounts(
  amounts: PayrollIncomeTaxDisplayAmounts,
  settings: Pick<IncomeTaxManagementSettings, 'withholdingEnabled'>
): PayrollIncomeTaxDisplayAmounts {
  if (settings.withholdingEnabled) {
    return amounts;
  }

  return {
    incomeTax: 0,
    totalDeductions: Math.max(0, amounts.totalDeductions - amounts.incomeTax),
    netPay: amounts.netPay + amounts.incomeTax,
  };
}
