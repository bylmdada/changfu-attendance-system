import { prisma } from '@/lib/database';
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

export async function getStoredHealthInsuranceFormulaConfig(): Promise<HealthInsuranceFormulaValues> {
  const healthInsuranceConfigModel = (prisma as unknown as {
    healthInsuranceConfig?: {
      findFirst: (args: {
        where: { isActive: boolean };
        orderBy: { effectiveDate: 'desc' };
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
    where: { isActive: true },
    orderBy: { effectiveDate: 'desc' },
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
