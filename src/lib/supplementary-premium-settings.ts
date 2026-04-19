import { prisma } from '@/lib/database';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';
import {
  getDefaultSupplementaryPremiumSettings,
  normalizeSupplementaryPremiumSettings,
  SUPPLEMENTARY_PREMIUM_SETTINGS_KEY,
  type SupplementaryPremiumSettings,
} from '@/lib/supplementary-premium-config';

export async function getStoredSupplementaryPremiumSettings(): Promise<SupplementaryPremiumSettings> {
  const settingModel = (prisma as unknown as {
    systemSettings?: {
      findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>;
    };
  }).systemSettings;

  if (!settingModel?.findUnique) {
    return getDefaultSupplementaryPremiumSettings();
  }

  const setting = await settingModel.findUnique({
    where: { key: SUPPLEMENTARY_PREMIUM_SETTINGS_KEY },
  });

  if (!setting) {
    return getDefaultSupplementaryPremiumSettings();
  }

  return normalizeSupplementaryPremiumSettings(
    safeParseSystemSettingsValue<Partial<SupplementaryPremiumSettings>>(
      setting.value,
      {},
      SUPPLEMENTARY_PREMIUM_SETTINGS_KEY
    )
  );
}

export async function getBonusSupplementaryPremiumContext(params: {
  employeeId: number;
  payrollYear: number;
  payrollMonth: number;
  settings: SupplementaryPremiumSettings;
  excludeRecordId?: number;
  db?: Pick<typeof prisma, 'bonusRecord'>;
}): Promise<{
  currentPeriodBonusTotal: number;
  currentYearPremiumTotal: number;
}> {
  const { employeeId, payrollYear, payrollMonth, settings, excludeRecordId, db = prisma } = params;
  const recordFilter = excludeRecordId === undefined
    ? {}
    : { id: { not: excludeRecordId } };

  const periodFilter = settings.resetPeriod === 'MONTHLY'
    ? { employeeId, payrollYear, payrollMonth, ...recordFilter }
    : { employeeId, payrollYear, ...recordFilter };

  const [periodRecords, yearRecords] = await Promise.all([
    db.bonusRecord.findMany({
      where: periodFilter,
      select: {
        amount: true,
      },
    }),
    db.bonusRecord.findMany({
      where: {
        employeeId,
        payrollYear,
        ...recordFilter,
      },
      select: {
        supplementaryPremium: true,
      },
    }),
  ]);

  return {
    currentPeriodBonusTotal: periodRecords.reduce((sum, record) => sum + record.amount, 0),
    currentYearPremiumTotal: yearRecords.reduce((sum, record) => sum + record.supplementaryPremium, 0),
  };
}
