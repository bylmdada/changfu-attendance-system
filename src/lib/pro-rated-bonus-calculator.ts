// 保留以備未來使用
// import { calculateBonusSupplementaryPremium, getInsuredAmount } from './tax-calculator';

/**
 * 按比例獎金計算結果接口
 */
export interface ProRatedBonusResult {
  employeeId: number;
  bonusType: string;
  bonusTypeName: string;
  fullAmount: number;           // 滿額獎金金額
  serviceMonths: number;        // 服務月數
  totalMonths: number;          // 計算基準總月數 (通常為12個月)
  proRatedRatio: number;        // 按比例係數 (0-1)
  proRatedAmount: number;       // 按比例獎金金額
  isProRated: boolean;          // 是否按比例計算
  calculationDetails: {
    hireDate: Date;
    calculationDate: Date;
    serviceStartDate: Date;
    serviceEndDate: Date;
    eligibleForBonus: boolean;
    minimumServiceMet: boolean;
  };
}

/**
 * 三節獎金計算結果接口
 */
export interface FestivalBonusResult extends ProRatedBonusResult {
  festivalInfo: {
    festivalName: string;
    festivalMonth: number;
    festivalDescription: string;
  };
}

/**
 * 計算員工服務月數
 * @param hireDate 到職日期
 * @param endDate 計算截止日期
 * @returns 服務月數 (含不足月按日數比例)
 */
export function calculateServiceMonths(hireDate: Date, endDate: Date): number {
  if (hireDate > endDate) {
    return 0;
  }

  const startYear = hireDate.getFullYear();
  const startMonth = hireDate.getMonth();
  const startDay = hireDate.getDate();
  
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();
  const endDay = endDate.getDate();

  // 計算完整月數
  let months = (endYear - startYear) * 12 + (endMonth - startMonth);
  
  // 處理不足月的情況
  if (endDay < startDay) {
    months -= 1;
    // 計算剩餘天數占該月的比例
    const daysInEndMonth = new Date(endYear, endMonth + 1, 0).getDate();
    const remainingDays = endDay + (daysInEndMonth - startDay + 1);
    const dayRatio = remainingDays / daysInEndMonth;
    months += dayRatio;
  } else if (endDay > startDay) {
    // 如果結束日期的日數大於開始日期，額外加上不足月的比例
    const daysInEndMonth = new Date(endYear, endMonth + 1, 0).getDate();
    const extraDays = endDay - startDay + 1;
    const dayRatio = extraDays / daysInEndMonth;
    months += dayRatio;
  }

  return Math.max(0, months);
}

/**
 * 計算年終獎金 (按比例)
 * @param employee 員工資訊
 * @param targetYear 目標年度
 * @param bonusConfig 獎金配置
 * @returns 年終獎金計算結果
 */
export async function calculateYearEndBonus(
  employee: {
    id: number;
    name: string;
    hireDate: Date;
    baseSalary: number;
    isActive: boolean;
  },
  targetYear: number,
  bonusConfig: {
    defaultAmount?: number;
    eligibilityRules: {
      minimumServiceMonths: number;
      mustBeActive: boolean;
      proRatedForPartialYear: boolean;
      proRatedThreshold?: number;
    };
  }
): Promise<ProRatedBonusResult> {
  const calculationDate = new Date(targetYear, 11, 31); // 12月31日為基準
  const yearStartDate = new Date(targetYear, 0, 1); // 1月1日
  
  // 確定服務期間的開始日期 (取到職日期和年初較晚者)
  const serviceStartDate = employee.hireDate > yearStartDate ? employee.hireDate : yearStartDate;
  
  // 計算服務月數
  const serviceMonths = calculateServiceMonths(serviceStartDate, calculationDate);
  const totalMonths = 12; // 年終獎金以12個月為基準
  
  // 檢查最低服務要求
  const minimumServiceMet = serviceMonths >= bonusConfig.eligibilityRules.minimumServiceMonths;
  const eligibleForBonus = minimumServiceMet && 
    (!bonusConfig.eligibilityRules.mustBeActive || employee.isActive);

  // 計算獎金金額
  const fullAmount = bonusConfig.defaultAmount || employee.baseSalary; // 默認為一個月薪資
  let proRatedAmount = 0;
  let isProRated = false;
  let proRatedRatio = 1;

  if (eligibleForBonus) {
    if (bonusConfig.eligibilityRules.proRatedForPartialYear && serviceMonths < totalMonths) {
      // 按比例計算
      proRatedRatio = serviceMonths / totalMonths;
      proRatedAmount = Math.round(fullAmount * proRatedRatio);
      isProRated = true;
    } else {
      // 全額發放
      proRatedAmount = fullAmount;
      proRatedRatio = 1;
      isProRated = false;
    }
  }

  return {
    employeeId: employee.id,
    bonusType: 'YEAR_END',
    bonusTypeName: '年終獎金',
    fullAmount,
    serviceMonths: Math.round(serviceMonths * 100) / 100, // 保留兩位小數
    totalMonths,
    proRatedRatio: Math.round(proRatedRatio * 1000) / 1000, // 保留三位小數
    proRatedAmount,
    isProRated,
    calculationDetails: {
      hireDate: employee.hireDate,
      calculationDate,
      serviceStartDate,
      serviceEndDate: calculationDate,
      eligibleForBonus,
      minimumServiceMet
    }
  };
}

/**
 * 計算三節獎金 (按比例)
 * @param employee 員工資訊
 * @param festivalInfo 節慶資訊
 * @param targetYear 目標年度
 * @param bonusConfig 獎金配置
 * @returns 三節獎金計算結果
 */
export async function calculateFestivalBonus(
  employee: {
    id: number;
    name: string;
    hireDate: Date;
    baseSalary: number;
    isActive: boolean;
  },
  festivalInfo: {
    name: string;
    month: number;
    description: string;
  },
  targetYear: number,
  bonusConfig: {
    defaultAmount: number;
    eligibilityRules: {
      minimumServiceMonths: number;
      mustBeActive: boolean;
      proRatedForPartialYear: boolean;
      proRatedThreshold?: number;
    };
  }
): Promise<FestivalBonusResult> {
  // 以節慶月份的最後一天為計算基準
  const calculationDate = new Date(targetYear, festivalInfo.month - 1, 
    new Date(targetYear, festivalInfo.month, 0).getDate());
  
  // 計算從到職日期到節慶日期的服務月數
  const serviceMonths = calculateServiceMonths(employee.hireDate, calculationDate);
  const proRatedThreshold = bonusConfig.eligibilityRules.proRatedThreshold || 12;
  
  // 檢查最低服務要求
  const minimumServiceMet = serviceMonths >= bonusConfig.eligibilityRules.minimumServiceMonths;
  const eligibleForBonus = minimumServiceMet && 
    (!bonusConfig.eligibilityRules.mustBeActive || employee.isActive);

  // 計算獎金金額
  const fullAmount = bonusConfig.defaultAmount;
  let proRatedAmount = 0;
  let isProRated = false;
  let proRatedRatio = 1;

  if (eligibleForBonus) {
    if (bonusConfig.eligibilityRules.proRatedForPartialYear && serviceMonths < proRatedThreshold) {
      // 按比例計算 (以12個月為滿額基準)
      proRatedRatio = Math.min(serviceMonths / 12, 1);
      proRatedAmount = Math.round(fullAmount * proRatedRatio);
      isProRated = true;
    } else {
      // 全額發放
      proRatedAmount = fullAmount;
      proRatedRatio = 1;
      isProRated = false;
    }
  }

  return {
    employeeId: employee.id,
    bonusType: 'FESTIVAL',
    bonusTypeName: `${festivalInfo.description}`,
    fullAmount,
    serviceMonths: Math.round(serviceMonths * 100) / 100, // 保留兩位小數
    totalMonths: 12, // 三節獎金也以12個月為基準
    proRatedRatio: Math.round(proRatedRatio * 1000) / 1000, // 保留三位小數
    proRatedAmount,
    isProRated,
    calculationDetails: {
      hireDate: employee.hireDate,
      calculationDate,
      serviceStartDate: employee.hireDate,
      serviceEndDate: calculationDate,
      eligibleForBonus,
      minimumServiceMet
    },
    festivalInfo: {
      festivalName: festivalInfo.name,
      festivalMonth: festivalInfo.month,
      festivalDescription: festivalInfo.description
    }
  };
}

/**
 * 批量計算員工年終獎金
 * @param employees 員工列表
 * @param targetYear 目標年度
 * @returns 年終獎金計算結果列表
 */
export async function batchCalculateYearEndBonus(
  employees: Array<{
    id: number;
    name: string;
    employeeId: string;
    hireDate: Date;
    baseSalary: number;
    isActive: boolean;
  }>,
  targetYear: number
): Promise<ProRatedBonusResult[]> {
  const bonusConfig = {
    defaultAmount: 0, // 將根據個人薪資計算
    eligibilityRules: {
      minimumServiceMonths: 3,
      mustBeActive: true,
      proRatedForPartialYear: true
    }
  };

  const results: ProRatedBonusResult[] = [];

  for (const employee of employees) {
    // 年終獎金預設為一個月薪資
    const configWithSalary = {
      ...bonusConfig,
      defaultAmount: employee.baseSalary
    };

    const result = await calculateYearEndBonus(employee, targetYear, configWithSalary);
    results.push(result);
  }

  return results;
}

/**
 * 批量計算員工三節獎金
 * @param employees 員工列表
 * @param festivalType 節慶類型
 * @param targetYear 目標年度
 * @returns 三節獎金計算結果列表
 */
export async function batchCalculateFestivalBonus(
  employees: Array<{
    id: number;
    name: string;
    employeeId: string;
    hireDate: Date;
    baseSalary: number;
    isActive: boolean;
  }>,
  festivalType: 'spring_festival' | 'dragon_boat' | 'mid_autumn',
  targetYear: number
): Promise<FestivalBonusResult[]> {
  const festivalMap = {
    spring_festival: { name: 'spring_festival', month: 2, description: '春節獎金' }, // 農曆春節通常在2月
    dragon_boat: { name: 'dragon_boat', month: 6, description: '端午節獎金' },
    mid_autumn: { name: 'mid_autumn', month: 9, description: '中秋節獎金' }
  };

  const festivalInfo = festivalMap[festivalType];
  const bonusConfig = {
    defaultAmount: 5000, // 預設三節獎金金額
    eligibilityRules: {
      minimumServiceMonths: 1,
      mustBeActive: true,
      proRatedForPartialYear: true,
      proRatedThreshold: 12
    }
  };

  const results: FestivalBonusResult[] = [];

  for (const employee of employees) {
    const result = await calculateFestivalBonus(employee, festivalInfo, targetYear, bonusConfig);
    results.push(result);
  }

  return results;
}

/**
 * 產生按比例獎金發放建議報表
 * @param employees 員工列表
 * @param targetYear 目標年度
 * @returns 綜合獎金發放建議
 */
export async function generateProRatedBonusReport(
  employees: Array<{
    id: number;
    name: string;
    employeeId: string;
    hireDate: Date;
    baseSalary: number;
    isActive: boolean;
    department?: string;
    position?: string;
  }>,
  targetYear: number
) {
  // 計算年終獎金
  const yearEndResults = await batchCalculateYearEndBonus(employees, targetYear);
  
  // 計算三節獎金
  const springFestivalResults = await batchCalculateFestivalBonus(employees, 'spring_festival', targetYear);
  const dragonBoatResults = await batchCalculateFestivalBonus(employees, 'dragon_boat', targetYear);
  const midAutumnResults = await batchCalculateFestivalBonus(employees, 'mid_autumn', targetYear);

  // 統計數據
  const statistics = {
    totalEmployees: employees.length,
    yearEndBonus: {
      eligibleCount: yearEndResults.filter(r => r.calculationDetails.eligibleForBonus).length,
      proRatedCount: yearEndResults.filter(r => r.isProRated).length,
      totalAmount: yearEndResults.reduce((sum, r) => sum + r.proRatedAmount, 0),
      averageAmount: 0
    },
    festivalBonus: {
      spring: {
        eligibleCount: springFestivalResults.filter(r => r.calculationDetails.eligibleForBonus).length,
        proRatedCount: springFestivalResults.filter(r => r.isProRated).length,
        totalAmount: springFestivalResults.reduce((sum, r) => sum + r.proRatedAmount, 0)
      },
      dragonBoat: {
        eligibleCount: dragonBoatResults.filter(r => r.calculationDetails.eligibleForBonus).length,
        proRatedCount: dragonBoatResults.filter(r => r.isProRated).length,
        totalAmount: dragonBoatResults.reduce((sum, r) => sum + r.proRatedAmount, 0)
      },
      midAutumn: {
        eligibleCount: midAutumnResults.filter(r => r.calculationDetails.eligibleForBonus).length,
        proRatedCount: midAutumnResults.filter(r => r.isProRated).length,
        totalAmount: midAutumnResults.reduce((sum, r) => sum + r.proRatedAmount, 0)
      }
    }
  };

  // 計算平均金額
  const eligibleYearEndCount = statistics.yearEndBonus.eligibleCount;
  statistics.yearEndBonus.averageAmount = eligibleYearEndCount > 0 
    ? Math.round(statistics.yearEndBonus.totalAmount / eligibleYearEndCount)
    : 0;

  return {
    targetYear,
    generatedAt: new Date(),
    statistics,
    yearEndBonusResults: yearEndResults,
    festivalBonusResults: {
      springFestival: springFestivalResults,
      dragonBoat: dragonBoatResults,
      midAutumn: midAutumnResults
    }
  };
}
