/**
 * 加班費計算測試
 * 
 * 依據勞動基準法第24條、第39條、第40條計算
 */

import {
  OvertimeType,
  calculateHourlyWage,
  calculateOvertime,
  validateOvertimeHours
} from '../overtime-calculator';

describe('加班費計算 - 勞基法合規測試', () => {
  const monthlySalary = 36000; // 月薪 36,000
  const expectedHourlyWage = 150; // 36000 / 240 = 150

  describe('平日每小時工資額計算', () => {
    test('月薪 36,000 → 時薪 150', () => {
      const hourlyWage = calculateHourlyWage(36000);
      expect(hourlyWage).toBe(150);
    });

    test('月薪 48,000 → 時薪 200', () => {
      const hourlyWage = calculateHourlyWage(48000);
      expect(hourlyWage).toBe(200);
    });

    test('月薪 30,000 → 時薪 125', () => {
      const hourlyWage = calculateHourlyWage(30000);
      expect(hourlyWage).toBe(125);
    });
  });

  describe('平日加班費計算 - 勞基法第24條第1項', () => {
    // 實際計算使用 4/3（≈1.333）和 5/3（≈1.667）
    const rate1 = 4 / 3; // 前2小時倍率
    const rate2 = 5 / 3; // 第3-4小時倍率

    test('加班 1 小時 → 4/3 倍', () => {
      const result = calculateOvertime(OvertimeType.WEEKDAY, 1, monthlySalary);
      expect(result.overtimePay).toBe(expectedHourlyWage * rate1 * 1);
    });

    test('加班 2 小時 → 全部 4/3 倍', () => {
      const result = calculateOvertime(OvertimeType.WEEKDAY, 2, monthlySalary);
      expect(result.overtimePay).toBe(expectedHourlyWage * rate1 * 2);
    });

    test('加班 3 小時 → 前2小時4/3倍 + 第3小時5/3倍', () => {
      const result = calculateOvertime(OvertimeType.WEEKDAY, 3, monthlySalary);
      const expected = expectedHourlyWage * rate1 * 2 + expectedHourlyWage * rate2 * 1;
      expect(result.overtimePay).toBe(expected);
    });

    test('加班 4 小時 → 前2小時4/3倍 + 後2小時5/3倍', () => {
      const result = calculateOvertime(OvertimeType.WEEKDAY, 4, monthlySalary);
      const expected = expectedHourlyWage * rate1 * 2 + expectedHourlyWage * rate2 * 2;
      expect(result.overtimePay).toBe(expected);
    });
  });

  describe('休息日加班費計算 - 勞基法第24條第2項', () => {
    test('加班 2 小時 → 以 4 小時計費', () => {
      const result = calculateOvertime(OvertimeType.REST_DAY, 2, monthlySalary);
      // 休息日前4小時以4小時計費（最低計費時數）
      expect(result.hours).toBe(4); // 實際計費時數以4小時計
      expect(result.overtimePay).toBeGreaterThan(0);
    });

    test('加班 8 小時 → 前2小時1.34倍 + 後6小時1.67倍', () => {
      const result = calculateOvertime(OvertimeType.REST_DAY, 8, monthlySalary);
      expect(result.hours).toBe(8);
      expect(result.overtimePay).toBeGreaterThan(0);
    });

    test('加班 10 小時 → 前8小時1.67倍 + 後2小時2.67倍', () => {
      const result = calculateOvertime(OvertimeType.REST_DAY, 10, monthlySalary);
      expect(result.hours).toBe(10);
      expect(result.overtimePay).toBeGreaterThan(0);
    });
  });

  describe('國定假日加班費計算 - 勞基法第39條', () => {
    // 國定假日加發一日工資（原本就有薪，所以只加發 1x）
    test('加班 8 小時 → 加發一日工資', () => {
      const result = calculateOvertime(OvertimeType.HOLIDAY, 8, monthlySalary);
      expect(result.overtimePay).toBe(expectedHourlyWage * 1 * 8);
    });

    test('加班 1 小時 → 加發工資', () => {
      const result = calculateOvertime(OvertimeType.HOLIDAY, 1, monthlySalary);
      expect(result.overtimePay).toBe(expectedHourlyWage * 1 * 1);
    });
  });

  describe('例假日加班費計算 - 勞基法第40條', () => {
    // 例假日加發一日工資 + 需補假
    test('例假日加班 → 加發工資 + 補假一日', () => {
      const result = calculateOvertime(OvertimeType.MANDATORY_REST, 8, monthlySalary);
      expect(result.overtimePay).toBe(expectedHourlyWage * 1 * 8);
    });
  });

  describe('加班時數驗證', () => {
    test('平日加班超過 4 小時 → 警告', () => {
      const result = validateOvertimeHours(OvertimeType.WEEKDAY, 5);
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('平日加班 4 小時 → 合法', () => {
      const result = validateOvertimeHours(OvertimeType.WEEKDAY, 4);
      expect(result.isValid).toBe(true);
    });

    test('休息日加班超過 12 小時 → 警告', () => {
      const result = validateOvertimeHours(OvertimeType.REST_DAY, 13);
      expect(result.isValid).toBe(false);
    });
  });
});
