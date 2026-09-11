import {
  calculateHealthInsurancePremium,
  calculateLaborInsurancePremium,
  findInsuredAmountByLevels,
  LABOR_INSURANCE_2026_LEVELS,
  HEALTH_INSURANCE_2026_LEVELS,
  resolveHealthInsuranceLevels,
} from '@/lib/insurance-calculator';

describe('insurance-calculator 2026 tables', () => {
  it('uses the 2026 labor insurance levels with the 45,800 cap', () => {
    expect(findInsuredAmountByLevels(29500, LABOR_INSURANCE_2026_LEVELS)).toBe(29500);
    expect(findInsuredAmountByLevels(29501, LABOR_INSURANCE_2026_LEVELS)).toBe(31800);
    expect(findInsuredAmountByLevels(60000, LABOR_INSURANCE_2026_LEVELS)).toBe(45800);
  });

  it('uses the 2026 health insurance common first 30 levels', () => {
    expect(findInsuredAmountByLevels(29500, HEALTH_INSURANCE_2026_LEVELS)).toBe(29500);
    expect(findInsuredAmountByLevels(29501, HEALTH_INSURANCE_2026_LEVELS)).toBe(30300);
    expect(findInsuredAmountByLevels(110100, HEALTH_INSURANCE_2026_LEVELS)).toBe(110100);
  });

  it('replaces stale health level tables with the 2026 first 30 levels', () => {
    expect(resolveHealthInsuranceLevels([
      { level: 1, minSalary: 0, maxSalary: 25000, insuredAmount: 25200 },
    ])).toHaveLength(30);
  });
});

describe('insurance-calculator premium formulas', () => {
  it('calculates labor employee premiums by rounding ordinary and employment insurance separately', () => {
    expect(calculateLaborInsurancePremium({
      salary: 29500,
      ordinaryRate: 0.115,
      employmentRate: 0.01,
      employeeRate: 0.2,
    }).employeePremium).toBe(738);

    const capped = calculateLaborInsurancePremium({
      salary: 60000,
      ordinaryRate: 0.115,
      employmentRate: 0.01,
      employeeRate: 0.2,
    });

    expect(capped.insuredAmount).toBe(45800);
    expect(capped.ordinaryEmployeePremium).toBe(1053);
    expect(capped.employmentEmployeePremium).toBe(92);
    expect(capped.employeePremium).toBe(1145);
  });

  it('calculates health insurance with 30 percent employee, 60 percent company, and 10 percent government ratios', () => {
    const premium = calculateHealthInsurancePremium({
      salary: 29500,
      premiumRate: 0.0517,
      employeeRate: 0.3,
      employerRate: 0.6,
      governmentRate: 0.1,
    });

    expect(premium.employeePremium).toBe(458);
    expect(premium.employerPremium).toBe(915);
    expect(premium.governmentPremium).toBe(153);
    expect(premium.totalPremium).toBe(1526);
  });
});
