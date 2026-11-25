import { prisma } from '@/lib/database';
import { getTaiwanTodayDateOnly } from '@/lib/timezone';
import {
  DEFAULT_LABOR_LAW_CONFIG,
  type LaborLawConfigValues,
} from '@/lib/labor-law-config-defaults';

/**
 * 取得「asOf 當天適用」的法規參數：啟用中、生效日不晚於 asOf 的最新一版。
 * 預排的未來版本在生效日之前不會被讀到；回算舊期請傳入該期的日期。
 */
export async function getStoredLaborLawConfig(asOf: Date = getTaiwanTodayDateOnly()): Promise<LaborLawConfigValues> {
  const laborLawConfigModel = (prisma as unknown as {
    laborLawConfig?: {
      findFirst: (args: {
        where: { isActive: boolean; effectiveDate: { lte: Date } };
        orderBy: Array<{ effectiveDate: 'desc' } | { id: 'desc' }>;
      }) => Promise<LaborLawConfigValues | null>;
    };
  }).laborLawConfig;

  if (!laborLawConfigModel?.findFirst) {
    return { ...DEFAULT_LABOR_LAW_CONFIG };
  }

  const config = await laborLawConfigModel.findFirst({
    where: { isActive: true, effectiveDate: { lte: asOf } },
    orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
  });

  if (!config) {
    return { ...DEFAULT_LABOR_LAW_CONFIG };
  }

  return {
    basicWage: config.basicWage,
    laborInsuranceRate: config.laborInsuranceRate,
    employmentInsuranceRate: config.employmentInsuranceRate ?? DEFAULT_LABOR_LAW_CONFIG.employmentInsuranceRate,
    laborInsuranceMax: config.laborInsuranceMax,
    laborEmployeeRate: config.laborEmployeeRate,
  };
}
