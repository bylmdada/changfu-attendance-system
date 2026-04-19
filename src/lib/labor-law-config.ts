import { prisma } from '@/lib/database';
import {
  DEFAULT_LABOR_LAW_CONFIG,
  type LaborLawConfigValues,
} from '@/lib/labor-law-config-defaults';

export async function getStoredLaborLawConfig(): Promise<LaborLawConfigValues> {
  const laborLawConfigModel = (prisma as unknown as {
    laborLawConfig?: {
      findFirst: (args: {
        where: { isActive: boolean };
        orderBy: { effectiveDate: 'desc' };
      }) => Promise<LaborLawConfigValues | null>;
    };
  }).laborLawConfig;

  if (!laborLawConfigModel?.findFirst) {
    return { ...DEFAULT_LABOR_LAW_CONFIG };
  }

  const config = await laborLawConfigModel.findFirst({
    where: { isActive: true },
    orderBy: { effectiveDate: 'desc' },
  });

  if (!config) {
    return { ...DEFAULT_LABOR_LAW_CONFIG };
  }

  return {
    basicWage: config.basicWage,
    laborInsuranceRate: config.laborInsuranceRate,
    laborInsuranceMax: config.laborInsuranceMax,
    laborEmployeeRate: config.laborEmployeeRate,
  };
}
