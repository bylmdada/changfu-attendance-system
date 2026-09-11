export interface InsuranceSalaryLevel {
  level: number;
  minSalary: number;
  maxSalary: number;
  insuredAmount: number;
}

export interface LaborInsuranceCalculation {
  insuredAmount: number;
  ordinaryEmployeePremium: number;
  employmentEmployeePremium: number;
  employeePremium: number;
  employerPremium: number;
  governmentPremium: number;
  totalPremium: number;
}

export interface HealthInsuranceCalculation {
  insuredAmount: number;
  dependents: number;
  totalPersons: number;
  employeePremium: number;
  employerPremium: number;
  governmentPremium: number;
  totalPremium: number;
}

export const LABOR_INSURANCE_2026_LEVELS: InsuranceSalaryLevel[] = [
  { level: 1, minSalary: 0, maxSalary: 29500, insuredAmount: 29500 },
  { level: 2, minSalary: 29501, maxSalary: 31800, insuredAmount: 31800 },
  { level: 3, minSalary: 31801, maxSalary: 33300, insuredAmount: 33300 },
  { level: 4, minSalary: 33301, maxSalary: 34800, insuredAmount: 34800 },
  { level: 5, minSalary: 34801, maxSalary: 36300, insuredAmount: 36300 },
  { level: 6, minSalary: 36301, maxSalary: 38200, insuredAmount: 38200 },
  { level: 7, minSalary: 38201, maxSalary: 40100, insuredAmount: 40100 },
  { level: 8, minSalary: 40101, maxSalary: 42000, insuredAmount: 42000 },
  { level: 9, minSalary: 42001, maxSalary: 43900, insuredAmount: 43900 },
  { level: 10, minSalary: 43901, maxSalary: 45800, insuredAmount: 45800 },
  { level: 11, minSalary: 45801, maxSalary: 999999999, insuredAmount: 45800 },
];

export const HEALTH_INSURANCE_2026_LEVELS: InsuranceSalaryLevel[] = [
  { level: 1, minSalary: 0, maxSalary: 29500, insuredAmount: 29500 },
  { level: 2, minSalary: 29501, maxSalary: 30300, insuredAmount: 30300 },
  { level: 3, minSalary: 30301, maxSalary: 31800, insuredAmount: 31800 },
  { level: 4, minSalary: 31801, maxSalary: 33300, insuredAmount: 33300 },
  { level: 5, minSalary: 33301, maxSalary: 34800, insuredAmount: 34800 },
  { level: 6, minSalary: 34801, maxSalary: 36300, insuredAmount: 36300 },
  { level: 7, minSalary: 36301, maxSalary: 38200, insuredAmount: 38200 },
  { level: 8, minSalary: 38201, maxSalary: 40100, insuredAmount: 40100 },
  { level: 9, minSalary: 40101, maxSalary: 42000, insuredAmount: 42000 },
  { level: 10, minSalary: 42001, maxSalary: 43900, insuredAmount: 43900 },
  { level: 11, minSalary: 43901, maxSalary: 45800, insuredAmount: 45800 },
  { level: 12, minSalary: 45801, maxSalary: 48200, insuredAmount: 48200 },
  { level: 13, minSalary: 48201, maxSalary: 50600, insuredAmount: 50600 },
  { level: 14, minSalary: 50601, maxSalary: 53000, insuredAmount: 53000 },
  { level: 15, minSalary: 53001, maxSalary: 55400, insuredAmount: 55400 },
  { level: 16, minSalary: 55401, maxSalary: 57800, insuredAmount: 57800 },
  { level: 17, minSalary: 57801, maxSalary: 60800, insuredAmount: 60800 },
  { level: 18, minSalary: 60801, maxSalary: 63800, insuredAmount: 63800 },
  { level: 19, minSalary: 63801, maxSalary: 66800, insuredAmount: 66800 },
  { level: 20, minSalary: 66801, maxSalary: 69800, insuredAmount: 69800 },
  { level: 21, minSalary: 69801, maxSalary: 72800, insuredAmount: 72800 },
  { level: 22, minSalary: 72801, maxSalary: 76500, insuredAmount: 76500 },
  { level: 23, minSalary: 76501, maxSalary: 80200, insuredAmount: 80200 },
  { level: 24, minSalary: 80201, maxSalary: 83900, insuredAmount: 83900 },
  { level: 25, minSalary: 83901, maxSalary: 87600, insuredAmount: 87600 },
  { level: 26, minSalary: 87601, maxSalary: 92100, insuredAmount: 92100 },
  { level: 27, minSalary: 92101, maxSalary: 96600, insuredAmount: 96600 },
  { level: 28, minSalary: 96601, maxSalary: 101100, insuredAmount: 101100 },
  { level: 29, minSalary: 101101, maxSalary: 105600, insuredAmount: 105600 },
  { level: 30, minSalary: 105601, maxSalary: 110100, insuredAmount: 110100 },
];

export function findInsuredAmountByLevels(salary: number, levels: InsuranceSalaryLevel[]): number {
  if (!Number.isFinite(salary) || levels.length === 0) return 0;

  const sortedLevels = [...levels].sort((a, b) => a.level - b.level);
  const matched = sortedLevels.find((level) => salary >= level.minSalary && salary <= level.maxSalary);
  return matched?.insuredAmount ?? sortedLevels[sortedLevels.length - 1].insuredAmount;
}

export function resolveHealthInsuranceLevels(levels?: InsuranceSalaryLevel[] | null): InsuranceSalaryLevel[] {
  if (!levels || levels.length < HEALTH_INSURANCE_2026_LEVELS.length) {
    return HEALTH_INSURANCE_2026_LEVELS;
  }

  const sortedLevels = [...levels].sort((a, b) => a.level - b.level);
  const firstLevel = sortedLevels[0];
  const thirtiethLevel = sortedLevels[29];

  if (
    firstLevel?.minSalary !== 0 ||
    firstLevel?.maxSalary !== 29500 ||
    firstLevel?.insuredAmount !== 29500 ||
    thirtiethLevel?.insuredAmount !== 110100
  ) {
    return HEALTH_INSURANCE_2026_LEVELS;
  }

  return sortedLevels;
}

export function calculateLaborInsurancePremium(params: {
  salary: number;
  ordinaryRate: number;
  employmentRate: number;
  employeeRate: number;
  employerRate?: number;
  governmentRate?: number;
  maxInsuredAmount?: number;
  levels?: InsuranceSalaryLevel[];
}): LaborInsuranceCalculation {
  const {
    salary,
    ordinaryRate,
    employmentRate,
    employeeRate,
    employerRate = 0.7,
    governmentRate = 0.1,
    maxInsuredAmount,
    levels = LABOR_INSURANCE_2026_LEVELS,
  } = params;
  const matchedInsuredAmount = findInsuredAmountByLevels(salary, levels);
  const insuredAmount = maxInsuredAmount ? Math.min(matchedInsuredAmount, maxInsuredAmount) : matchedInsuredAmount;
  const ordinaryEmployeePremium = Math.round(insuredAmount * ordinaryRate * employeeRate);
  const employmentEmployeePremium = Math.round(insuredAmount * employmentRate * employeeRate);
  const ordinaryEmployerPremium = Math.round(insuredAmount * ordinaryRate * employerRate);
  const employmentEmployerPremium = Math.round(insuredAmount * employmentRate * employerRate);
  const ordinaryGovernmentPremium = Math.round(insuredAmount * ordinaryRate * governmentRate);
  const employmentGovernmentPremium = Math.round(insuredAmount * employmentRate * governmentRate);

  return {
    insuredAmount,
    ordinaryEmployeePremium,
    employmentEmployeePremium,
    employeePremium: ordinaryEmployeePremium + employmentEmployeePremium,
    employerPremium: ordinaryEmployerPremium + employmentEmployerPremium,
    governmentPremium: ordinaryGovernmentPremium + employmentGovernmentPremium,
    totalPremium:
      ordinaryEmployeePremium +
      employmentEmployeePremium +
      ordinaryEmployerPremium +
      employmentEmployerPremium +
      ordinaryGovernmentPremium +
      employmentGovernmentPremium,
  };
}

export function calculateHealthInsurancePremium(params: {
  salary: number;
  premiumRate: number;
  employeeRate: number;
  employerRate: number;
  governmentRate: number;
  dependents?: number;
  maxDependents?: number;
  levels?: InsuranceSalaryLevel[];
}): HealthInsuranceCalculation {
  const {
    salary,
    premiumRate,
    employeeRate,
    employerRate,
    governmentRate,
    dependents = 0,
    maxDependents = 3,
    levels = HEALTH_INSURANCE_2026_LEVELS,
  } = params;
  const insuredAmount = findInsuredAmountByLevels(salary, levels);
  const normalizedDependents = Math.min(Math.max(Math.trunc(dependents), 0), Math.max(maxDependents, 0));
  const totalPersons = 1 + normalizedDependents;
  const employeePremium = Math.round(insuredAmount * premiumRate * employeeRate * totalPersons);
  const employerPremium = Math.round(insuredAmount * premiumRate * employerRate * totalPersons);
  const governmentPremium = Math.round(insuredAmount * premiumRate * governmentRate * totalPersons);

  return {
    insuredAmount,
    dependents: normalizedDependents,
    totalPersons,
    employeePremium,
    employerPremium,
    governmentPremium,
    totalPremium: employeePremium + employerPremium + governmentPremium,
  };
}
