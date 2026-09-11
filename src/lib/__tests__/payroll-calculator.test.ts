/**
 * 薪資計算整合測試
 */

import {
  calculateMonthlyPayroll,
  calculatePayrollTotals,
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
    test('月薪 40,000 與投保級距 40,100 不混為同一欄位', () => {
      const employee: EmployeePayrollInfo = {
        ...mockEmployee,
        id: 36,
        employeeId: '2026990001',
        name: '測試甲',
        baseSalary: 40000,
        hourlyRate: 167,
        insuredBase: 40000,
        employeeType: 'MONTHLY',
      };

      const payroll = calculateMonthlyPayroll(employee, [], 2026, 7);
      const totals = calculatePayrollTotals(
        employee,
        payroll.grossPay,
        0,
        undefined,
        undefined,
        { incomeTaxEnabled: false }
      );

      expect(payroll.hourlyWage).toBe(167);
      expect(payroll.basePay).toBe(40000);
      expect(payroll.grossPay).toBe(40000);
      expect(totals.deductions.laborInsurance).toBe(1002);
      expect(totals.deductions.healthInsurance).toBe(622);
      expect(totals.netPay).toBe(38376);
    });

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

    test('加班費使用薪資檔時薪，不重新用月薪除以240', () => {
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

      const result = calculateMonthlyPayroll(
        { ...mockEmployee, hourlyRate: 200 },
        attendanceRecords,
        2024,
        1
      );

      expect(result.hourlyWage).toBe(200);
      expect(result.totalOvertimePay).toBeCloseTo(200 * 2 * (4 / 3));
    });

    test('僅補休模式 → 保留加班時數但不計入加班費', () => {
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

      const result = calculateMonthlyPayroll(mockEmployee, attendanceRecords, 2024, 1, {
        overtimeCompensationMode: 'COMP_LEAVE_ONLY',
      });

      expect(result.totalOvertimeHours).toBe(2);
      expect(result.totalOvertimePay).toBe(0);
      expect(result.grossPay).toBe(result.basePay);
      expect(result.calculationNotes).toContain('本月加班補償模式為僅給予補休時數，本次薪資不另計加班費。');
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

  test.each([2, 3, 10])('applies weekday tiers separately to %i work dates', days => {
    const records = Array.from({ length: days }, (_, i) => ({
      workDate: new Date(`2026-09-${String(i + 1).padStart(2, '0')}T00:00:00+08:00`),
      regularHours: 8, overtimeHours: 2, overtimeType: OvertimeType.WEEKDAY,
      isHoliday: false, isRestDay: false, isMandatoryRest: false,
    }));
    const result = calculateMonthlyPayroll({ ...mockEmployee, hourlyRate: 150 }, records, 2026, 9);
    expect(result.totalOvertimePay).toBe(days * 400);
    expect(result.overtimeDetails[0].overtimePay).toBe(days * 400);
    expect(calculateMonthlyPayroll(mockEmployee, records, 2026, 9, { overtimeCompensationMode: 'COMP_LEAVE_ONLY' }).totalOvertimePay).toBe(0);
  });

  test('combines duplicate rows within one work date before applying tiers', () => {
    const record = { workDate: new Date('2026-09-01T00:00:00+08:00'), regularHours: 0,
      overtimeHours: 2, overtimeType: OvertimeType.WEEKDAY, isHoliday: false, isRestDay: false, isMandatoryRest: false };
    expect(calculateMonthlyPayroll({ ...mockEmployee, hourlyRate: 150 }, [record, record], 2026, 9).totalOvertimePay).toBe(900);
  });

  test.each([[OvertimeType.REST_DAY, 3800], [OvertimeType.HOLIDAY, 2400]])('keeps two %s work dates separate', (type, expected) => {
    const records = [1, 2].map(day => ({ workDate: new Date(`2026-09-0${day}T00:00:00+08:00`),
      regularHours: 0, overtimeHours: 8, overtimeType: type as OvertimeType,
      isHoliday: type === OvertimeType.HOLIDAY, isRestDay: type === OvertimeType.REST_DAY, isMandatoryRest: false }));
    expect(calculateMonthlyPayroll({...mockEmployee,hourlyRate:150}, records, 2026, 9).totalOvertimePay).toBe(expected);
  });

  describe('獎金調整後扣款', () => {
    test('加上獎金後會重算所得稅與補充保費，但保留原本保險基礎扣款', () => {
      const employeeWithPension: EmployeePayrollInfo = {
        ...mockEmployee,
        laborPensionSelfRate: 3,
      };

      const baseTotals = calculatePayrollTotals(employeeWithPension, 40000);
      const bonusTotals = calculatePayrollTotals(employeeWithPension, 40000, 200000);

      expect(bonusTotals.grossPay).toBe(240000);
      expect(bonusTotals.deductions.laborInsurance).toBe(baseTotals.deductions.laborInsurance);
      expect(bonusTotals.deductions.healthInsurance).toBe(baseTotals.deductions.healthInsurance);
      expect(bonusTotals.deductions.laborPensionSelf).toBe(baseTotals.deductions.laborPensionSelf);
      expect(bonusTotals.deductions.supplementaryInsurance).toBeGreaterThan(baseTotals.deductions.supplementaryInsurance);
      expect(bonusTotals.deductions.incomeTax).toBeGreaterThan(baseTotals.deductions.incomeTax);
      expect(bonusTotals.netPay).toBeLessThan(baseTotals.netPay + 200000);
    });

    test('停用補充保費設定時不扣補充保費', () => {
      const totals = calculatePayrollTotals(mockEmployee, 40000, 200000, {
        isEnabled: false,
        premiumRate: 2.11,
        exemptThresholdMultiplier: 4,
        calculationMethod: 'cumulative',
        resetPeriod: 'yearly',
        salaryThreshold: 183200,
        dividendThreshold: 20000,
        applyToAllEmployees: true,
        salaryIncludeItems: {
          allowance: true,
          commission: true,
          overtime: true,
        },
      });

      expect(totals.deductions.supplementaryInsurance).toBe(0);
    });

    test('停用所得稅扣除時不計入所得稅', () => {
      const totals = calculatePayrollTotals(mockEmployee, 40000, 0, undefined, undefined, {
        incomeTaxEnabled: false,
      });

      expect(totals.deductions.incomeTax).toBe(0);
      expect(totals.netPay).toBe(40000 - totals.totalDeductions);
    });

    test('未參加健保時不應扣健保費', () => {
      const employeeWithoutHealthInsurance: EmployeePayrollInfo = {
        ...mockEmployee,
        healthInsuranceActive: false,
        dependents: 2,
      };

      const totals = calculatePayrollTotals(employeeWithoutHealthInsurance, 40000);

      expect(totals.deductions.healthInsurance).toBe(0);
    });

    test('眷屬人數異常時會被正規化', () => {
      const employeeWithInvalidDependents: EmployeePayrollInfo = {
        ...mockEmployee,
        dependents: -3,
      };

      const totals = calculatePayrollTotals(employeeWithInvalidDependents, 40000);

      expect(totals.deductions.healthInsurance).toBeGreaterThan(0);
    });

    test('套用法規參數設定中的勞保費率、負擔比例與投保薪資上限', () => {
      const totals = calculatePayrollTotals(
        { ...mockEmployee, insuredBase: 80000 },
        80000,
        0,
        undefined,
        {
          basicWage: 29500,
          laborInsuranceRate: 0.1,
          employmentInsuranceRate: 0.01,
          laborInsuranceMax: 40000,
          laborEmployeeRate: 0.5,
        }
      );

      expect(totals.deductions.laborInsurance).toBe(2200);
    });

    test('套用健保公式設定中的費率、負擔比例與投保級距', () => {
      const totals = calculatePayrollTotals(
        { ...mockEmployee, insuredBase: 40000, dependents: 1 },
        40000,
        0,
        undefined,
        undefined,
        {
          healthInsuranceConfig: {
            premiumRate: 0.05,
            employeeContributionRatio: 0.25,
            companyContributionRatio: 0.65,
            governmentSubsidyRatio: 0.1,
            maxDependents: 3,
            salaryLevels: [
              { level: 1, minSalary: 0, maxSalary: 50000, insuredAmount: 50000 },
            ],
          },
        }
      );

      expect(totals.deductions.healthInsurance).toBe(1250);
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
