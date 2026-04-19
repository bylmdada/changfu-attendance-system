import {
  calculateAverageMonthlyGrossPay,
  calculateOvertimePayShare,
  countMonthsWithPayroll,
} from '@/lib/payroll-statistics-metrics';

describe('payroll statistics metrics', () => {
  it('counts only months with positive payroll totals', () => {
    expect(
      countMonthsWithPayroll([
        { totalGrossPay: 0 },
        { totalGrossPay: 120000 },
        { totalGrossPay: 50000 },
        { totalGrossPay: 0 },
      ])
    ).toBe(2);
  });

  it('returns null when no month has payroll data', () => {
    expect(
      calculateAverageMonthlyGrossPay(0, [
        { totalGrossPay: 0 },
        { totalGrossPay: 0 },
      ])
    ).toBeNull();
  });

  it('averages across active payroll months only', () => {
    expect(
      calculateAverageMonthlyGrossPay(300000, [
        { totalGrossPay: 0 },
        { totalGrossPay: 100000 },
        { totalGrossPay: 200000 },
      ])
    ).toBe(150000);
  });

  it('calculates overtime pay share from actual overtime pay', () => {
    expect(calculateOvertimePayShare(12000, 80000)).toBe(15);
  });

  it('returns zero overtime pay share when gross pay is zero', () => {
    expect(calculateOvertimePayShare(12000, 0)).toBe(0);
  });
});
