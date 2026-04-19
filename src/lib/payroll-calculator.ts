/**
 * 薪資計算工具 - 整合勞基法加班費計算
 */

import { 
  OvertimeType, 
  calculateOvertime, 
  calculateHourlyWage,
  OvertimeCalculationResult 
} from './overtime-calculator';
import {
  getDefaultSupplementaryPremiumSettings,
  getSupplementaryPremiumExemptThreshold,
  getSupplementaryPremiumRateDecimal,
  type SupplementaryPremiumSettings,
} from './supplementary-premium-config';
import {
  DEFAULT_LABOR_LAW_CONFIG,
  type LaborLawConfigValues,
} from './labor-law-config-defaults';

// 薪資計算結果接口
export interface PayrollCalculationResult {
  // 基本資訊
  employeeId: number;
  payYear: number;
  payMonth: number;
  
  // 工時統計
  regularHours: number;
  totalOvertimeHours: number;
  overtimeBreakdown: OvertimeBreakdown;
  
  // 薪資組成
  basePay: number;
  hourlyWage: number;
  totalOvertimePay: number;
  grossPay: number;
  
  // 扣除項目
  deductions: PayrollDeductions;
  totalDeductions: number;
  
  // 最終薪資
  netPay: number;
  
  // 詳細資訊
  overtimeDetails: OvertimeCalculationResult[];
  calculationNotes: string[];
}

// 加班時數分類
export interface OvertimeBreakdown {
  weekdayHours: number;      // 平日加班時數
  restDayHours: number;      // 休息日加班時數
  holidayHours: number;      // 國定假日加班時數
  mandatoryRestHours: number; // 例假日加班時數
}

// 薪資扣除項目
export interface PayrollDeductions {
  laborInsurance: number;        // 勞工保險
  healthInsurance: number;       // 健康保險
  supplementaryInsurance: number; // 補充保費
  laborPensionSelf: number;      // 勞退自提
  incomeTax: number;            // 所得稅
  other: number;                // 其他扣除
}

export interface PayrollTotals {
  grossPay: number;
  deductions: PayrollDeductions;
  totalDeductions: number;
  netPay: number;
}

export function normalizeDependentsCount(dependents: unknown, maxDependents = 10): number {
  if (typeof dependents !== 'number' || !Number.isFinite(dependents)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(dependents), 0), maxDependents);
}

// 員工基本資訊（用於薪資計算）
export interface EmployeePayrollInfo {
  id: number;
  employeeId: string;
  name: string;
  baseSalary: number;
  hourlyRate?: number; // 可選，將從baseSalary計算
  department: string;
  position: string;
  dependents?: number; // 眷屬人數（用於健保計算）
  insuredBase?: number; // 投保薪資（用於勞健保計算）
  laborPensionSelfRate?: number; // 勞退自提比例（0-6%）
  employeeType?: string; // MONTHLY（月薪人員）| HOURLY（計時人員）
  laborInsuranceActive?: boolean; // 是否參加勞保（預設 true）
  healthInsuranceActive?: boolean; // 是否參加健保（預設 true）
}

// 考勤記錄（用於薪資計算）
export interface AttendanceForPayroll {
  workDate: Date;
  regularHours: number;
  overtimeHours: number;
  overtimeType: OvertimeType;
  isHoliday: boolean;
  isRestDay: boolean;
  isMandatoryRest: boolean;
}

/**
 * 計算員工月薪資
 * 
 * @param employee 員工資訊
 * @param attendanceRecords 考勤記錄
 * @param year 薪資年份
 * @param month 薪資月份
 * @returns 薪資計算結果
 */
export function calculateMonthlyPayroll(
  employee: EmployeePayrollInfo,
  attendanceRecords: AttendanceForPayroll[],
  year: number,
  month: number
): PayrollCalculationResult {
  // 計算平日每小時工資額
  const hourlyWage = employee.hourlyRate || calculateHourlyWage(employee.baseSalary);
  
  // 統計工時
  let regularHours = 0;
  const overtimeBreakdown: OvertimeBreakdown = {
    weekdayHours: 0,
    restDayHours: 0,
    holidayHours: 0,
    mandatoryRestHours: 0
  };

  // 分類加班時數
  attendanceRecords.forEach(record => {
    regularHours += record.regularHours;
    
    if (record.overtimeHours > 0) {
      switch (record.overtimeType) {
        case OvertimeType.WEEKDAY:
          overtimeBreakdown.weekdayHours += record.overtimeHours;
          break;
        case OvertimeType.REST_DAY:
          overtimeBreakdown.restDayHours += record.overtimeHours;
          break;
        case OvertimeType.HOLIDAY:
          overtimeBreakdown.holidayHours += record.overtimeHours;
          break;
        case OvertimeType.MANDATORY_REST:
          overtimeBreakdown.mandatoryRestHours += record.overtimeHours;
          break;
      }
    }
  });

  // 計算各類加班費
  const overtimeDetails: OvertimeCalculationResult[] = [];
  let totalOvertimePay = 0;

  if (overtimeBreakdown.weekdayHours > 0) {
    const result = calculateOvertime(OvertimeType.WEEKDAY, overtimeBreakdown.weekdayHours, employee.baseSalary);
    overtimeDetails.push(result);
    totalOvertimePay += result.overtimePay;
  }

  if (overtimeBreakdown.restDayHours > 0) {
    const result = calculateOvertime(OvertimeType.REST_DAY, overtimeBreakdown.restDayHours, employee.baseSalary);
    overtimeDetails.push(result);
    totalOvertimePay += result.overtimePay;
  }

  if (overtimeBreakdown.holidayHours > 0) {
    const result = calculateOvertime(OvertimeType.HOLIDAY, overtimeBreakdown.holidayHours, employee.baseSalary);
    overtimeDetails.push(result);
    totalOvertimePay += result.overtimePay;
  }

  if (overtimeBreakdown.mandatoryRestHours > 0) {
    const result = calculateOvertime(OvertimeType.MANDATORY_REST, overtimeBreakdown.mandatoryRestHours, employee.baseSalary);
    overtimeDetails.push(result);
    totalOvertimePay += result.overtimePay;
  }

  // 計算總工時
  const totalOvertimeHours = Object.values(overtimeBreakdown).reduce((sum, hours) => sum + hours, 0);

  // 計算基本薪資
  // 月薪人員：固定月薪
  // 計時人員：時薪 × 實際工時
  let basePay: number;
  if (employee.employeeType === 'HOURLY') {
    // 計時人員：時薪 × (正常工時 + 加班工時)
    basePay = Math.round(hourlyWage * regularHours);
  } else {
    // 月薪人員：固定月薪
    basePay = employee.baseSalary;
  }
  
  const grossPay = basePay + totalOvertimePay;

  // 計算扣除項目
  const totals = calculatePayrollTotals(employee, grossPay);

  // 生成計算備註
  const calculationNotes = generateCalculationNotes(employee, overtimeBreakdown, overtimeDetails);

  return {
    employeeId: employee.id,
    payYear: year,
    payMonth: month,
    regularHours,
    totalOvertimeHours,
    overtimeBreakdown,
    basePay,
    hourlyWage,
    totalOvertimePay,
    grossPay: totals.grossPay,
    deductions: totals.deductions,
    totalDeductions: totals.totalDeductions,
    netPay: totals.netPay,
    overtimeDetails,
    calculationNotes
  };
}

/**
 * 計算薪資扣除項目
 * 
 * @param employee 員工資訊
 * @param grossPay 總薪資
 * @returns 扣除項目詳細
 */
export function calculatePayrollDeductions(
  employee: EmployeePayrollInfo,
  grossPay: number,
  supplementarySettings: SupplementaryPremiumSettings = getDefaultSupplementaryPremiumSettings(),
  laborLawConfig: LaborLawConfigValues = DEFAULT_LABOR_LAW_CONFIG
): PayrollDeductions {
  // 使用投保薪資或實際薪資計算勞健保
  const insuredSalary = employee.insuredBase || grossPay;
  
  // 勞保費計算（員工負擔20%）
  // 如果員工不參加勞保，則不扣除
  let laborInsurance = 0;
  if (employee.laborInsuranceActive !== false) {
    const laborInsuredSalary = Math.min(insuredSalary, laborLawConfig.laborInsuranceMax);
    laborInsurance = Math.round(
      laborInsuredSalary * laborLawConfig.laborInsuranceRate * laborLawConfig.laborEmployeeRate
    );
  }

  // 健保費計算（員工負擔30%，眷屬加計）
  let healthInsurance = 0;
  if (employee.healthInsuranceActive !== false) {
    const healthInsuranceRate = 0.0517; // 5.17%
    const employeeHealthRate = 0.3; // 員工負擔30%
    const dependents = normalizeDependentsCount(employee.dependents);
    const healthInsuranceUnit = Math.round(insuredSalary * healthInsuranceRate);
    healthInsurance = Math.round(healthInsuranceUnit * employeeHealthRate * (1 + dependents));
  }

  const supplementaryInsurance = calculatePayrollSupplementaryInsurance(
    grossPay,
    insuredSalary,
    supplementarySettings
  );

  // 勞退自提計算（0-6%，員工自願提繳）
  const laborPensionSelfRate = employee.laborPensionSelfRate || 0;
  const laborPensionSelf = Math.round(insuredSalary * laborPensionSelfRate / 100);

  // 所得稅計算（簡化版本，勞退自提可從所得扣除）
  const taxableGross = grossPay - laborPensionSelf; // 勞退自提免稅
  const incomeTax = calculateSimpleIncomeTax(taxableGross);

  return {
    laborInsurance,
    healthInsurance,
    supplementaryInsurance,
    laborPensionSelf,
    incomeTax,
    other: 0
  };
}

export function calculatePayrollTotals(
  employee: EmployeePayrollInfo,
  grossPay: number,
  totalBonus = 0,
  supplementarySettings: SupplementaryPremiumSettings = getDefaultSupplementaryPremiumSettings(),
  laborLawConfig: LaborLawConfigValues = DEFAULT_LABOR_LAW_CONFIG
): PayrollTotals {
  const baseDeductions = calculatePayrollDeductions(
    employee,
    grossPay,
    supplementarySettings,
    laborLawConfig
  );
  const adjustedGrossPay = grossPay + totalBonus;
  const deductions = totalBonus > 0
    ? {
        ...baseDeductions,
        supplementaryInsurance: calculatePayrollSupplementaryInsurance(
          adjustedGrossPay,
          employee.insuredBase || grossPay,
          supplementarySettings
        ),
        incomeTax: calculateSimpleIncomeTax(adjustedGrossPay - baseDeductions.laborPensionSelf),
      }
    : baseDeductions;
  const totalDeductions = Object.values(deductions).reduce((sum, amount) => sum + amount, 0);

  return {
    grossPay: adjustedGrossPay,
    deductions,
    totalDeductions,
    netPay: adjustedGrossPay - totalDeductions,
  };
}

function calculatePayrollSupplementaryInsurance(
  grossPay: number,
  insuredAmount: number,
  supplementarySettings: SupplementaryPremiumSettings
): number {
  if (!supplementarySettings.isEnabled) {
    return 0;
  }

  const supplementaryThreshold = getSupplementaryPremiumExemptThreshold(insuredAmount, supplementarySettings);
  if (grossPay <= supplementaryThreshold) {
    return 0;
  }

  const calculatedPremium = Math.round(
    (grossPay - supplementaryThreshold) * getSupplementaryPremiumRateDecimal(supplementarySettings)
  );
  return Math.min(calculatedPremium, supplementarySettings.maxMonthlyPremium);
}

/**
 * 簡化所得稅計算
 * 
 * @param grossPay 總薪資
 * @returns 所得稅金額
 */
function calculateSimpleIncomeTax(grossPay: number): number {
  // 簡化計算：使用5%稅率計算預扣所得稅
  // 實際計算應考慮扣除額、免稅額等
  const taxableIncome = Math.max(0, grossPay - 4000); // 簡化扣除額
  return Math.round(taxableIncome * 0.05);
}

/**
 * 生成薪資計算備註
 * 
 * @param employee 員工資訊
 * @param overtimeBreakdown 加班時數分類
 * @param overtimeDetails 加班費詳細計算
 * @returns 計算備註陣列
 */
function generateCalculationNotes(
  employee: EmployeePayrollInfo,
  overtimeBreakdown: OvertimeBreakdown,
  overtimeDetails: OvertimeCalculationResult[]
): string[] {
  const notes: string[] = [];

  // 基本資訊備註
  notes.push(`平日每小時工資額：NT$ ${calculateHourlyWage(employee.baseSalary).toLocaleString()}`);
  notes.push(`計算基準：月薪 NT$ ${employee.baseSalary.toLocaleString()} ÷ 240 小時`);

  // 加班時數備註
  if (overtimeBreakdown.weekdayHours > 0) {
    notes.push(`平日加班：${overtimeBreakdown.weekdayHours} 小時`);
  }
  if (overtimeBreakdown.restDayHours > 0) {
    notes.push(`休息日加班：${overtimeBreakdown.restDayHours} 小時`);
  }
  if (overtimeBreakdown.holidayHours > 0) {
    notes.push(`國定假日加班：${overtimeBreakdown.holidayHours} 小時`);
  }
  if (overtimeBreakdown.mandatoryRestHours > 0) {
    notes.push(`例假日加班：${overtimeBreakdown.mandatoryRestHours} 小時（需補假）`);
  }

  // 加班費計算詳細備註
  overtimeDetails.forEach(detail => {
    detail.details.forEach(item => {
      notes.push(`${item.description}：${item.hours} 小時 × NT$ ${item.rate.toLocaleString()} = NT$ ${item.amount.toLocaleString()}`);
    });
  });

  // 法規依據備註
  notes.push('');
  notes.push('計算依據：');
  notes.push('• 勞動基準法第24條（延長工作時間工資）');
  notes.push('• 勞動基準法第39條（假日工資）');
  notes.push('• 勞動基準法第40條（例假）');

  return notes;
}

/**
 * 驗證薪資計算結果
 * 
 * @param result 薪資計算結果
 * @returns 驗證結果
 */
export function validatePayrollCalculation(result: PayrollCalculationResult): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 檢查基本數據合理性
  if (result.netPay < 0) {
    errors.push('實領薪資不得為負數');
  }

  if (result.totalOvertimeHours > 120) { // 假設月加班時數上限
    warnings.push(`月加班時數 ${result.totalOvertimeHours} 小時可能超過法定上限`);
  }

  // 檢查例假日加班
  if (result.overtimeBreakdown.mandatoryRestHours > 0) {
    warnings.push('發現例假日加班記錄，請確認是否符合法定例外情況');
  }

  // 檢查扣除項目合理性
  if (result.totalDeductions > result.grossPay * 0.3) {
    warnings.push('扣除項目金額較高，請檢查計算是否正確');
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors
  };
}
