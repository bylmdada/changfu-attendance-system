/**
 * 加班費計算工具 - 依據勞動基準法
 * 
 * 根據勞基法第24條、第39條、第40條規定計算各類加班費
 */

// 加班類型枚舉
export enum OvertimeType {
  WEEKDAY = 'WEEKDAY',           // 平日加班（延長工作時間）
  REST_DAY = 'REST_DAY',         // 休息日加班
  HOLIDAY = 'HOLIDAY',           // 國定假日/特休假加班
  MANDATORY_REST = 'MANDATORY_REST' // 例假日加班（原則違法）
}

// 加班計算結果接口
export interface OvertimeCalculationResult {
  type: OvertimeType;
  hours: number;
  hourlyWage: number;
  overtimePay: number;
  details: OvertimePayDetail[];
}

// 加班費詳細計算項目
export interface OvertimePayDetail {
  description: string;
  hours: number;
  rate: number;
  amount: number;
}

/**
 * 計算平日每小時工資額
 * 公式：月薪總額 ÷ 240
 * 
 * @param monthlySalary 月薪總額（包含所有經常性給與）
 * @returns 平日每小時工資額
 */
export function calculateHourlyWage(monthlySalary: number): number {
  return monthlySalary / 240;
}

/**
 * 計算平日加班費（延長工作時間）
 * 法源依據：勞基法第24條第1項
 * 
 * @param hours 加班時數
 * @param hourlyWage 平日每小時工資額
 * @returns 加班費計算結果
 */
export function calculateWeekdayOvertime(hours: number, hourlyWage: number): OvertimeCalculationResult {
  if (hours <= 0) {
    return {
      type: OvertimeType.WEEKDAY,
      hours: 0,
      hourlyWage,
      overtimePay: 0,
      details: []
    };
  }

  // 每日加班上限4小時
  const actualHours = Math.min(hours, 4);
  const details: OvertimePayDetail[] = [];
  let totalPay = 0;

  // 前2小時：平日每小時工資額 × (4/3)
  const firstTwoHours = Math.min(actualHours, 2);
  if (firstTwoHours > 0) {
    const rate = 4/3;
    const amount = firstTwoHours * hourlyWage * rate;
    totalPay += amount;
    details.push({
      description: `平日加班前2小時 (${rate.toFixed(2)}倍)`,
      hours: firstTwoHours,
      rate: hourlyWage * rate,
      amount
    });
  }

  // 第3-4小時：平日每小時工資額 × (5/3)
  const nextTwoHours = Math.max(0, actualHours - 2);
  if (nextTwoHours > 0) {
    const rate = 5/3;
    const amount = nextTwoHours * hourlyWage * rate;
    totalPay += amount;
    details.push({
      description: `平日加班第3-4小時 (${rate.toFixed(2)}倍)`,
      hours: nextTwoHours,
      rate: hourlyWage * rate,
      amount
    });
  }

  return {
    type: OvertimeType.WEEKDAY,
    hours: actualHours,
    hourlyWage,
    overtimePay: totalPay,
    details
  };
}

/**
 * 計算休息日加班費
 * 法源依據：勞基法第24條第2項
 * 
 * @param hours 加班時數
 * @param hourlyWage 平日每小時工資額
 * @returns 加班費計算結果
 */
export function calculateRestDayOvertime(hours: number, hourlyWage: number): OvertimeCalculationResult {
  if (hours <= 0) {
    return {
      type: OvertimeType.REST_DAY,
      hours: 0,
      hourlyWage,
      overtimePay: 0,
      details: []
    };
  }

  // 休息日特殊規則：
  // - 4小時內以4小時計
  // - 超過4小時、8小時內以8小時計  
  // - 超過8小時、12小時內以12小時計
  let billableHours: number;
  if (hours <= 4) {
    billableHours = 4;
  } else if (hours <= 8) {
    billableHours = 8;
  } else {
    billableHours = Math.min(hours, 12);
  }

  const details: OvertimePayDetail[] = [];
  let totalPay = 0;

  // 前2小時：平日每小時工資額 × (4/3)
  const firstTwoHours = Math.min(billableHours, 2);
  if (firstTwoHours > 0) {
    const rate = 4/3;
    const amount = firstTwoHours * hourlyWage * rate;
    totalPay += amount;
    details.push({
      description: `休息日加班前2小時 (${rate.toFixed(2)}倍)`,
      hours: firstTwoHours,
      rate: hourlyWage * rate,
      amount
    });
  }

  // 第3-8小時：平日每小時工資額 × (5/3)
  const nextSixHours = Math.min(Math.max(0, billableHours - 2), 6);
  if (nextSixHours > 0) {
    const rate = 5/3;
    const amount = nextSixHours * hourlyWage * rate;
    totalPay += amount;
    details.push({
      description: `休息日加班第3-8小時 (${rate.toFixed(2)}倍)`,
      hours: nextSixHours,
      rate: hourlyWage * rate,
      amount
    });
  }

  // 第9-12小時：平日每小時工資額 × (8/3)
  const finalFourHours = Math.max(0, billableHours - 8);
  if (finalFourHours > 0) {
    const rate = 8/3;
    const amount = finalFourHours * hourlyWage * rate;
    totalPay += amount;
    details.push({
      description: `休息日加班第9-12小時 (${rate.toFixed(2)}倍)`,
      hours: finalFourHours,
      rate: hourlyWage * rate,
      amount
    });
  }

  return {
    type: OvertimeType.REST_DAY,
    hours: billableHours,
    hourlyWage,
    overtimePay: totalPay,
    details
  };
}

/**
 * 計算國定假日/特休假加班費
 * 法源依據：勞基法第39條
 * 
 * @param hours 加班時數
 * @param hourlyWage 平日每小時工資額
 * @returns 加班費計算結果
 */
export function calculateHolidayOvertime(hours: number, hourlyWage: number): OvertimeCalculationResult {
  if (hours <= 0) {
    return {
      type: OvertimeType.HOLIDAY,
      hours: 0,
      hourlyWage,
      overtimePay: 0,
      details: []
    };
  }

  const details: OvertimePayDetail[] = [];
  let totalPay = 0;

  // 前8小時：雙倍薪（加發一日工資）
  const regularHours = Math.min(hours, 8);
  if (regularHours > 0) {
    const amount = regularHours * hourlyWage; // 加發一日工資
    totalPay += amount;
    details.push({
      description: `國定假日加班費 (雙倍薪)`,
      hours: regularHours,
      rate: hourlyWage,
      amount
    });
  }

  // 超過8小時：比照平日加班費率計算
  const extraHours = Math.max(0, hours - 8);
  if (extraHours > 0) {
    const overtimeResult = calculateWeekdayOvertime(extraHours, hourlyWage);
    totalPay += overtimeResult.overtimePay;
    details.push(...overtimeResult.details.map(detail => ({
      ...detail,
      description: detail.description.replace('平日', '國定假日超時')
    })));
  }

  return {
    type: OvertimeType.HOLIDAY,
    hours,
    hourlyWage,
    overtimePay: totalPay,
    details
  };
}

/**
 * 計算例假日加班費（原則違法）
 * 法源依據：勞基法第40條
 * 
 * @param hours 加班時數
 * @param hourlyWage 平日每小時工資額
 * @returns 加班費計算結果
 */
export function calculateMandatoryRestOvertime(hours: number, hourlyWage: number): OvertimeCalculationResult {
  if (hours <= 0) {
    return {
      type: OvertimeType.MANDATORY_REST,
      hours: 0,
      hourlyWage,
      overtimePay: 0,
      details: []
    };
  }

  // 例假日加班：雙倍薪 + 補假
  const amount = hours * hourlyWage;
  const details: OvertimePayDetail[] = [{
    description: '例假日加班費 (雙倍薪，需補假)',
    hours,
    rate: hourlyWage,
    amount
  }];

  return {
    type: OvertimeType.MANDATORY_REST,
    hours,
    hourlyWage,
    overtimePay: amount,
    details
  };
}

/**
 * 綜合加班費計算器
 * 
 * @param overtimeType 加班類型
 * @param hours 加班時數
 * @param monthlySalary 月薪總額
 * @returns 加班費計算結果
 */
export function calculateOvertime(
  overtimeType: OvertimeType,
  hours: number,
  monthlySalary: number
): OvertimeCalculationResult {
  const hourlyWage = calculateHourlyWage(monthlySalary);

  switch (overtimeType) {
    case OvertimeType.WEEKDAY:
      return calculateWeekdayOvertime(hours, hourlyWage);
    case OvertimeType.REST_DAY:
      return calculateRestDayOvertime(hours, hourlyWage);
    case OvertimeType.HOLIDAY:
      return calculateHolidayOvertime(hours, hourlyWage);
    case OvertimeType.MANDATORY_REST:
      return calculateMandatoryRestOvertime(hours, hourlyWage);
    default:
      throw new Error(`不支援的加班類型: ${overtimeType}`);
  }
}

/**
 * 驗證加班時數限制
 * 
 * @param overtimeType 加班類型
 * @param hours 加班時數
 * @returns 驗證結果
 */
export function validateOvertimeHours(overtimeType: OvertimeType, hours: number): {
  isValid: boolean;
  error?: string;
  maxHours?: number;
} {
  switch (overtimeType) {
    case OvertimeType.WEEKDAY:
      if (hours > 4) {
        return {
          isValid: false,
          error: '平日加班每日不得超過4小時',
          maxHours: 4
        };
      }
      break;
    case OvertimeType.REST_DAY:
      if (hours > 12) {
        return {
          isValid: false,
          error: '休息日加班每日不得超過12小時',
          maxHours: 12
        };
      }
      break;
    case OvertimeType.HOLIDAY:
    case OvertimeType.MANDATORY_REST:
      // 國定假日和例假日沒有特定時數限制，但應合理
      break;
  }

  return { isValid: true };
}
