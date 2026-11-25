import { prisma } from '@/lib/database';
import { getTaiwanTodayDateOnly } from '@/lib/timezone';
import {
  HEALTH_INSURANCE_2026_LEVELS,
  resolveHealthInsuranceLevels,
  type InsuranceSalaryLevel,
} from '@/lib/insurance-calculator';

export interface HealthInsuranceFormulaValues {
  premiumRate: number;
  employeeContributionRatio: number;
  companyContributionRatio: number;
  governmentSubsidyRatio: number;
  maxDependents: number;
  salaryLevels: InsuranceSalaryLevel[];
}

export const DEFAULT_HEALTH_INSURANCE_FORMULA: HealthInsuranceFormulaValues = {
  premiumRate: 0.0517,
  employeeContributionRatio: 0.3,
  companyContributionRatio: 0.6,
  governmentSubsidyRatio: 0.1,
  maxDependents: 3,
  salaryLevels: HEALTH_INSURANCE_2026_LEVELS,
};

/** 取得「asOf 當天適用」的健保公式：啟用中、生效日不晚於 asOf 的最新一版（預排的未來版本不會提前生效）。 */
export async function getStoredHealthInsuranceFormulaConfig(asOf: Date = getTaiwanTodayDateOnly()): Promise<HealthInsuranceFormulaValues> {
  const healthInsuranceConfigModel = (prisma as unknown as {
    healthInsuranceConfig?: {
      findFirst: (args: {
        where: { isActive: boolean; effectiveDate: { lte: Date } };
        orderBy: Array<{ effectiveDate: 'desc' } | { id: 'desc' }>;
        include: { salaryLevels: { orderBy: { level: 'asc' } } };
      }) => Promise<(
        Partial<Omit<HealthInsuranceFormulaValues, 'salaryLevels'>> & {
          salaryLevels?: InsuranceSalaryLevel[] | null;
        }
      ) | null>;
    };
  }).healthInsuranceConfig;

  if (!healthInsuranceConfigModel?.findFirst) {
    return { ...DEFAULT_HEALTH_INSURANCE_FORMULA };
  }

  const config = await healthInsuranceConfigModel.findFirst({
    where: { isActive: true, effectiveDate: { lte: asOf } },
    orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
    include: {
      salaryLevels: {
        orderBy: { level: 'asc' },
      },
    },
  });

  if (!config) {
    return { ...DEFAULT_HEALTH_INSURANCE_FORMULA };
  }

  return {
    premiumRate: config.premiumRate ?? DEFAULT_HEALTH_INSURANCE_FORMULA.premiumRate,
    employeeContributionRatio:
      config.employeeContributionRatio ?? DEFAULT_HEALTH_INSURANCE_FORMULA.employeeContributionRatio,
    companyContributionRatio:
      config.companyContributionRatio ?? DEFAULT_HEALTH_INSURANCE_FORMULA.companyContributionRatio,
    governmentSubsidyRatio:
      config.governmentSubsidyRatio ?? DEFAULT_HEALTH_INSURANCE_FORMULA.governmentSubsidyRatio,
    maxDependents: config.maxDependents ?? DEFAULT_HEALTH_INSURANCE_FORMULA.maxDependents,
    salaryLevels: resolveHealthInsuranceLevels(config.salaryLevels),
  };
}
