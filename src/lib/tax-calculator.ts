// 台灣稅金計算相關函數
import {
  getDefaultSupplementaryPremiumSettings,
  getSupplementaryPremiumExemptThreshold,
  getSupplementaryPremiumMinimumEligibleAmount,
  getSupplementaryPremiumRateDecimal,
  type SupplementaryPremiumSettings,
} from '@/lib/supplementary-premium-config';

// 個人所得稅免稅額和標準扣除額 (2024年版)
export const TAX_CONFIG = {
  PERSONAL_EXEMPTION: 92000, // 個人免稅額
  STANDARD_DEDUCTION: 124000, // 標準扣除額
  SALARY_DEDUCTION: 218000, // 薪資所得特別扣除額
  
  // 勞保費率 (2024年)
  LABOR_INSURANCE_RATE: 0.115, // 11.5%
  LABOR_INSURANCE_MAX: 45800, // 勞保投保薪資上限
  
  // 健保費率 (2024年)
  HEALTH_INSURANCE_RATE: 0.0517, // 5.17%
  HEALTH_INSURANCE_MAX: 182000, // 健保投保薪資上限
  
  // 所得稅率級距 (2024年)
  INCOME_TAX_BRACKETS: [
    { min: 0, max: 560000, rate: 0.05 },
    { min: 560000, max: 1260000, rate: 0.12 },
    { min: 1260000, max: 2520000, rate: 0.20 },
    { min: 2520000, max: 4720000, rate: 0.30 },
    { min: 4720000, max: Infinity, rate: 0.40 }
  ]
};

// 計算勞保費用
export function calculateLaborInsurance(monthlySalary: number): number {
  const insuredSalary = Math.min(monthlySalary, TAX_CONFIG.LABOR_INSURANCE_MAX);
  const employeeRate = 0.2; // 員工負擔比例
  return Math.round(insuredSalary * TAX_CONFIG.LABOR_INSURANCE_RATE * employeeRate);
}

// 健保費計算配置
export interface HealthInsuranceConfig {
  premiumRate: number;              // 保險費率 (預設 5.17%)
  employeeContributionRatio: number; // 員工負擔比例 (預設 30%)
  maxDependents: number;            // 最大眷屬人數上限 (預設 3)
  insuredSalaryTable: InsuredSalaryLevel[]; // 投保金額分級表
}

// 投保金額分級表結構
export interface InsuredSalaryLevel {
  minSalary: number;     // 月薪下限
  maxSalary: number;     // 月薪上限  
  insuredAmount: number; // 對應投保金額
}

// 員工健保投保資訊
export interface EmployeeHealthInsurance {
  employeeId: string;
  dependentsCount: number;  // 實際扶養眷屬人數
  isActive: boolean;        // 是否啟用健保
  startDate: Date;          // 投保開始日期
  endDate?: Date;          // 投保結束日期 (可選)
}

// 預設健保費配置
const DEFAULT_HEALTH_INSURANCE_CONFIG: HealthInsuranceConfig = {
  premiumRate: 0.0517,              // 5.17%
  employeeContributionRatio: 0.30,  // 30%
  maxDependents: 3,                 // 最多3位眷屬
  insuredSalaryTable: [
    { minSalary: 0, maxSalary: 25000, insuredAmount: 25200 },
    { minSalary: 25001, maxSalary: 26400, insuredAmount: 26400 },
    { minSalary: 26401, maxSalary: 27600, insuredAmount: 27600 },
    { minSalary: 27601, maxSalary: 28800, insuredAmount: 28800 },
    { minSalary: 28801, maxSalary: 30300, insuredAmount: 30300 },
    { minSalary: 30301, maxSalary: 31800, insuredAmount: 31800 },
    { minSalary: 31801, maxSalary: 33300, insuredAmount: 33300 },
    { minSalary: 33301, maxSalary: 34800, insuredAmount: 34800 },
    { minSalary: 34801, maxSalary: 36300, insuredAmount: 36300 },
    { minSalary: 36301, maxSalary: 38200, insuredAmount: 38200 },
    { minSalary: 38201, maxSalary: 40100, insuredAmount: 40100 },
    { minSalary: 40101, maxSalary: 42000, insuredAmount: 42000 },
    { minSalary: 42001, maxSalary: 43900, insuredAmount: 43900 },
    { minSalary: 43901, maxSalary: 45800, insuredAmount: 45800 },
    { minSalary: 45801, maxSalary: 48200, insuredAmount: 48200 },
    { minSalary: 48201, maxSalary: 50600, insuredAmount: 50600 },
    { minSalary: 50601, maxSalary: 53000, insuredAmount: 53000 },
    { minSalary: 53001, maxSalary: 55400, insuredAmount: 55400 },
    { minSalary: 55401, maxSalary: 57800, insuredAmount: 57800 },
    { minSalary: 57801, maxSalary: 60800, insuredAmount: 60800 },
    { minSalary: 60801, maxSalary: 63800, insuredAmount: 63800 },
    { minSalary: 63801, maxSalary: 66800, insuredAmount: 66800 },
    { minSalary: 66801, maxSalary: 69800, insuredAmount: 69800 },
    { minSalary: 69801, maxSalary: 72800, insuredAmount: 72800 },
    { minSalary: 72801, maxSalary: 76500, insuredAmount: 76500 },
    { minSalary: 76501, maxSalary: 80200, insuredAmount: 80200 },
    { minSalary: 80201, maxSalary: 83900, insuredAmount: 83900 },
    { minSalary: 83901, maxSalary: 87600, insuredAmount: 87600 },
    { minSalary: 87601, maxSalary: 92100, insuredAmount: 92100 },
    { minSalary: 92101, maxSalary: 96600, insuredAmount: 96600 },
    { minSalary: 96601, maxSalary: 101100, insuredAmount: 101100 },
    { minSalary: 101101, maxSalary: 105600, insuredAmount: 105600 },
    { minSalary: 105601, maxSalary: 110100, insuredAmount: 110100 },
    { minSalary: 110101, maxSalary: 115500, insuredAmount: 115500 },
    { minSalary: 115501, maxSalary: 120900, insuredAmount: 120900 },
    { minSalary: 120901, maxSalary: 126300, insuredAmount: 126300 },
    { minSalary: 126301, maxSalary: 131700, insuredAmount: 131700 },
    { minSalary: 131701, maxSalary: 137100, insuredAmount: 137100 },
    { minSalary: 137101, maxSalary: 142500, insuredAmount: 142500 },
    { minSalary: 142501, maxSalary: 147900, insuredAmount: 147900 },
    { minSalary: 147901, maxSalary: 154200, insuredAmount: 154200 },
    { minSalary: 154201, maxSalary: 160500, insuredAmount: 160500 },
    { minSalary: 160501, maxSalary: 166800, insuredAmount: 166800 },
    { minSalary: 166801, maxSalary: 173100, insuredAmount: 173100 },
    { minSalary: 173101, maxSalary: 179400, insuredAmount: 179400 },
    { minSalary: 179401, maxSalary: 186000, insuredAmount: 186000 },
    { minSalary: 186001, maxSalary: Infinity, insuredAmount: 186000 }
  ]
};

/**
 * 根據月薪查找對應的健保投保金額
 */
export function getInsuredAmount(
  monthlySalary: number, 
  config: HealthInsuranceConfig = DEFAULT_HEALTH_INSURANCE_CONFIG
): number {
  const level = config.insuredSalaryTable.find(
    level => monthlySalary >= level.minSalary && monthlySalary <= level.maxSalary
  );
  
  return level ? level.insuredAmount : config.insuredSalaryTable[config.insuredSalaryTable.length - 1].insuredAmount;
}

/**
 * 計算健保費
 * 公式: 投保金額 × 保險費率 × 員工負擔比例 × (本人 + 眷屬人數)
 */
export function calculateHealthInsurance(
  monthlySalary: number,
  dependentsCount: number,
  config: HealthInsuranceConfig = DEFAULT_HEALTH_INSURANCE_CONFIG
): {
  insuredAmount: number;
  actualDependents: number;
  totalInsuredPersons: number;
  individualPremium: number;
  totalPremium: number;
  calculation: string;
} {
  // 1. 查找投保金額
  const insuredAmount = getInsuredAmount(monthlySalary, config);
  
  // 2. 計算實際計費眷屬人數 (最多3位)
  const actualDependents = Math.min(dependentsCount, config.maxDependents);
  
  // 3. 計算總計費人數 (本人 + 眷屬)
  const totalInsuredPersons = 1 + actualDependents;
  
  // 4. 計算個人單月保費
  const individualPremium = Math.round(
    insuredAmount * config.premiumRate * config.employeeContributionRatio
  );
  
  // 5. 計算總健保費
  const totalPremium = individualPremium * totalInsuredPersons;
  
  // 6. 生成計算說明
  const calculation = `${insuredAmount} × ${(config.premiumRate * 100).toFixed(2)}% × ${(config.employeeContributionRatio * 100).toFixed(0)}% × ${totalInsuredPersons} = ${totalPremium}`;
  
  return {
    insuredAmount,
    actualDependents,
    totalInsuredPersons,
    individualPremium,
    totalPremium,
    calculation
  };
}

/**
 * 更新健保費配置
 */
export function updateHealthInsuranceConfig(
  updates: Partial<HealthInsuranceConfig>
): HealthInsuranceConfig {
  return {
    ...DEFAULT_HEALTH_INSURANCE_CONFIG,
    ...updates
  };
}

// 計算所得稅預扣稅額 (簡化版月預扣)
export function calculateIncomeTax(annualSalary: number): number {
  // 計算應稅所得
  const taxableIncome = Math.max(0, 
    annualSalary - TAX_CONFIG.PERSONAL_EXEMPTION - TAX_CONFIG.STANDARD_DEDUCTION - TAX_CONFIG.SALARY_DEDUCTION
  );
  
  let tax = 0;
  let remainingIncome = taxableIncome;
  
  for (const bracket of TAX_CONFIG.INCOME_TAX_BRACKETS) {
    if (remainingIncome <= 0) break;
    
    const taxableInThisBracket = Math.min(remainingIncome, bracket.max - bracket.min);
    tax += taxableInThisBracket * bracket.rate;
    remainingIncome -= taxableInThisBracket;
  }
  
  return Math.round(tax / 12); // 月預扣稅額
}

// 計算總扣除額
export interface TaxCalculationResult {
  laborInsurance: number;
  healthInsurance: number;
  supplementaryHealthInsurance: number;
  incomeTax: number;
  totalDeductions: number;
  netSalary: number;
  healthInsuranceDetails?: {
    insuredAmount: number;
    actualDependents: number;
    totalInsuredPersons: number;
    individualPremium: number;
    totalPremium: number;
    calculation: string;
  };
}

export function calculateAllDeductions(
  grossSalary: number, 
  annualSalary: number = grossSalary * 12,
  dependentsCount: number = 0,
  bonusSupplementaryPremium: number = 0,
  supplementarySettings: SupplementaryPremiumSettings = getDefaultSupplementaryPremiumSettings()
): TaxCalculationResult {
  const laborInsurance = calculateLaborInsurance(grossSalary);
  const healthInsuranceResult = calculateHealthInsurance(grossSalary, dependentsCount);
  const healthInsurance = healthInsuranceResult.totalPremium;
  
  // 使用傳入的獎金補充保費，如果沒有則使用薪資補充保費計算
  const supplementaryHealthInsurance = bonusSupplementaryPremium > 0 
    ? bonusSupplementaryPremium 
    : calculateSupplementaryHealthInsurance(
        grossSalary,
        healthInsuranceResult.insuredAmount,
        supplementarySettings
      );
    
  const incomeTax = calculateIncomeTax(annualSalary);
  
  const totalDeductions = laborInsurance + healthInsurance + supplementaryHealthInsurance + incomeTax;
  const netSalary = grossSalary - totalDeductions;
  
  return {
    laborInsurance,
    healthInsurance,
    supplementaryHealthInsurance,
    incomeTax,
    totalDeductions,
    netSalary,
    healthInsuranceDetails: healthInsuranceResult
  };
}

/**
 * 補充保費計算結果接口
 */
export interface SupplementaryPremiumResult {
  type: 'salary' | 'bonus' | 'part_time';
  calculationBase: number;
  premiumRate: number;
  premiumAmount: number;
  details: {
    originalAmount?: number;
    threshold?: number;
    exemptAmount?: number;
    cumulativeBonus?: number;
    exceededAmount?: number;
  };
}

/**
 * 獎金補充保費計算接口
 */
export interface BonusSupplementaryCalculation {
  employeeId: number;
  insuredAmount: number;
  currentYearBonusTotal: number;
  newBonusAmount: number;
  exemptThreshold: number;
  calculationBase: number;
  premiumRate: number;
  premiumAmount: number;
  shouldDeduct: boolean;
}

/**
 * 計算補充保費 (二代健保) - 薪資所得
 * 適用於一般月薪資，超過4倍投保金額上限時需繳納
 */
export function calculateSupplementaryHealthInsurance(
  monthlySalary: number,
  insuredAmount: number = monthlySalary,
  settings: SupplementaryPremiumSettings = getDefaultSupplementaryPremiumSettings()
): number {
  if (!settings.isEnabled) {
    return 0;
  }

  const threshold = getSupplementaryPremiumExemptThreshold(insuredAmount, settings);
  if (monthlySalary <= threshold) {
    return 0;
  }

  const supplementaryRate = getSupplementaryPremiumRateDecimal(settings);
  const calculatedPremium = Math.round((monthlySalary - threshold) * supplementaryRate);
  return Math.min(calculatedPremium, settings.maxMonthlyPremium);
}

/**
 * 計算獎金補充保費 (二代健保)
 * 適用於年終獎金、三節獎金、績效獎金等非經常性薪資
 * 
 * @param employeeInsuredAmount 員工健保投保金額
 * @param currentPeriodBonusTotal 目前計算週期內已發放獎金總額
 * @param newBonusAmount 本次發放獎金金額
 * @returns 獎金補充保費計算結果
 */
export function calculateBonusSupplementaryPremium(
  employeeInsuredAmount: number,
  currentPeriodBonusTotal: number,
  newBonusAmount: number,
  settings: SupplementaryPremiumSettings = getDefaultSupplementaryPremiumSettings(),
  currentYearPremiumTotal: number = 0
): BonusSupplementaryCalculation {
  const premiumRate = getSupplementaryPremiumRateDecimal(settings);
  const exemptThreshold = getSupplementaryPremiumExemptThreshold(employeeInsuredAmount, settings);
  const minimumEligibleAmount = getSupplementaryPremiumMinimumEligibleAmount(settings);
  const maxCalculationBase = 10000000; // 單次計費基礎上限1000萬元
  
  // 計算本次發放後的累計獎金總額
  const newCumulativeTotal = currentPeriodBonusTotal + newBonusAmount;
  
  let calculationBase = 0;
  let shouldDeduct = false;

  if (
    settings.isEnabled &&
    settings.salaryIncludeItems.bonus &&
    newBonusAmount >= minimumEligibleAmount &&
    newCumulativeTotal > exemptThreshold
  ) {
    shouldDeduct = true;

    if (settings.calculationMethod === 'MONTHLY') {
      calculationBase = newBonusAmount;
    } else if (currentPeriodBonusTotal <= exemptThreshold) {
      calculationBase = newCumulativeTotal - exemptThreshold;
    } else {
      calculationBase = newBonusAmount;
    }
  }

  calculationBase = Math.min(calculationBase, maxCalculationBase);

  const uncappedPremiumAmount = shouldDeduct ? Math.round(calculationBase * premiumRate) : 0;
  const monthlyCappedPremium = Math.min(uncappedPremiumAmount, settings.maxMonthlyPremium);
  const remainingAnnualDeduction = Math.max(0, settings.annualMaxDeduction - currentYearPremiumTotal);
  const premiumAmount = shouldDeduct ? Math.min(monthlyCappedPremium, remainingAnnualDeduction) : 0;
  
  return {
    employeeId: 0, // 將由呼叫方填入
    insuredAmount: employeeInsuredAmount,
    currentYearBonusTotal: currentPeriodBonusTotal,
    newBonusAmount,
    exemptThreshold,
    calculationBase,
    premiumRate,
    premiumAmount,
    shouldDeduct
  };
}

/**
 * 計算兼職薪資補充保費 (二代健保)
 * 適用於在非主要投保單位領取的薪資
 * 
 * @param salaryAmount 兼職薪資金額
 * @param basicWage 基本工資 (2024年為27,470元)
 * @returns 兼職薪資補充保費計算結果
 */
export function calculatePartTimeSupplementaryPremium(
  salaryAmount: number,
  basicWage: number = 27470
): SupplementaryPremiumResult {
  const premiumRate = 0.0211; // 2.11%
  
  if (salaryAmount < basicWage) {
    return {
      type: 'part_time',
      calculationBase: 0,
      premiumRate: 0,
      premiumAmount: 0,
      details: {
        originalAmount: salaryAmount,
        threshold: basicWage,
        exemptAmount: salaryAmount
      }
    };
  }
  
  const premiumAmount = Math.round(salaryAmount * premiumRate);
  
  return {
    type: 'part_time',
    calculationBase: salaryAmount,
    premiumRate,
    premiumAmount,
    details: {
      originalAmount: salaryAmount,
      threshold: basicWage,
      exemptAmount: 0
    }
  };
}
