/**
 * 薪資計算整合測試
 */

import {
  calculateMonthlyPayroll,
  validatePayrollCalculation,
  EmployeePayrollInfo,
  AttendanceForPayroll
} from '../payroll-calculator';
import { OvertimeType } from '../overtime-calculator';

describe('月薪資計算整合測試', () => {
  const mockEmployee: EmployeePayrollInfo = {
    id: 1,
    employeeId: 'EMP001',
    name: '測試員工',
    baseSalary: 36000,
    department: '工程部',
    position: '工程師',
    dependents: 0,
    insuredBase: 36300
  };

  describe('基本薪資計算', () => {
    test('無加班 → 只有基本薪', () => {
      const attendanceRecords: AttendanceForPayroll[] = Array.from({ length: 22 }, (_, i) => ({
        workDate: new Date(2024, 0, i + 1),
        regularHours: 8,
        overtimeHours: 0,
        overtimeType: OvertimeType.WEEKDAY,
        isHoliday: false,
        isRestDay: false,
        isMandatoryRest: false
      }));

      const result = calculateMonthlyPayroll(mockEmployee, attendanceRecords, 2024, 1);

      expect(result.employeeId).toBe(1);
      expect(result.basePay).toBe(36000);
      expect(result.totalOvertimeHours).toBe(0);
      expect(result.totalOvertimePay).toBe(0);
    });

    test('有加班 → 基本薪 + 加班費', () => {
      const attendanceRecords: AttendanceForPayroll[] = [
        {
          workDate: new Date(2024, 0, 15),
          regularHours: 8,
          overtimeHours: 2,
          overtimeType: OvertimeType.WEEKDAY,
          isHoliday: false,
          isRestDay: false,
          isMandatoryRest: false
        }
      ];

      const result = calculateMonthlyPayroll(mockEmployee, attendanceRecords, 2024, 1);

      expect(result.totalOvertimeHours).toBe(2);
      expect(result.totalOvertimePay).toBeGreaterThan(0);
      expect(result.grossPay).toBeGreaterThan(result.basePay);
    });

    test('國定假日加班 → 2倍工資', () => {
      const attendanceRecords: AttendanceForPayroll[] = [
        {
          workDate: new Date(2024, 0, 1), // 元旦
          regularHours: 0,
          overtimeHours: 8,
          overtimeType: OvertimeType.HOLIDAY,
          isHoliday: true,
          isRestDay: false,
          isMandatoryRest: false
        }
      ];

      const result = calculateMonthlyPayroll(mockEmployee, attendanceRecords, 2024, 1);

      expect(result.overtimeBreakdown.holidayHours).toBe(8);
      expect(result.totalOvertimePay).toBeGreaterThan(0);
    });
  });

  describe('薪資驗證', () => {
    test('正常薪資 → 驗證通過', () => {
      const mockResult = {
        employeeId: 1,
        payYear: 2024,
        payMonth: 1,
        regularHours: 176,
        totalOvertimeHours: 10,
        overtimeBreakdown: {
          weekdayHours: 10,
          restDayHours: 0,
          holidayHours: 0,
          mandatoryRestHours: 0
        },
        basePay: 36000,
        hourlyWage: 150,
        totalOvertimePay: 2500,
        grossPay: 38500,
        deductions: {
          laborInsurance: 828,
          healthInsurance: 550,
          supplementaryInsurance: 0,
          laborPensionSelf: 0,
          incomeTax: 500,
          other: 0
        },
        totalDeductions: 1878,
        netPay: 36622,
        overtimeDetails: [],
        calculationNotes: []
      };

      const validation = validatePayrollCalculation(mockResult);

      expect(validation.isValid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    test('負薪資 → 驗證失敗', () => {
      const mockResult = {
        employeeId: 1,
        payYear: 2024,
        payMonth: 1,
        regularHours: 176,
        totalOvertimeHours: 0,
        overtimeBreakdown: {
          weekdayHours: 0,
          restDayHours: 0,
          holidayHours: 0,
          mandatoryRestHours: 0
        },
        basePay: 10000,
        hourlyWage: 42,
        totalOvertimePay: 0,
        grossPay: 10000,
        deductions: {
          laborInsurance: 828,
          healthInsurance: 550,
          supplementaryInsurance: 0,
          laborPensionSelf: 0,
          incomeTax: 500,
          other: 10000
        },
        totalDeductions: 11878,
        netPay: -1878,
        overtimeDetails: [],
        calculationNotes: []
      };

      const validation = validatePayrollCalculation(mockResult);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    test('加班超過 120 小時 → 發出警告', () => {
      const mockResult = {
        employeeId: 1,
        payYear: 2024,
        payMonth: 1,
        regularHours: 176,
        totalOvertimeHours: 130,
        overtimeBreakdown: {
          weekdayHours: 130,
          restDayHours: 0,
          holidayHours: 0,
          mandatoryRestHours: 0
        },
        basePay: 36000,
        hourlyWage: 150,
        totalOvertimePay: 25000,
        grossPay: 61000,
        deductions: {
          laborInsurance: 1000,
          healthInsurance: 700,
          supplementaryInsurance: 0,
          laborPensionSelf: 0,
          incomeTax: 1000,
          other: 0
        },
        totalDeductions: 2700,
        netPay: 58300,
        overtimeDetails: [],
        calculationNotes: []
      };

      const validation = validatePayrollCalculation(mockResult);

      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings.some(w => w.includes('超過法定上限'))).toBe(true);
    });
  });
});
