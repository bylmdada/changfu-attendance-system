import {
  calculateMonthlyExemptOvertimePay,
  sumExemptOvertimePay,
  TAX_EXEMPT_OVERTIME_MONTHLY_HOURS,
} from '@/lib/overtime-tax-exemption';

describe('tax exempt overtime pay', () => {
  it('caps each month at 46 hours of the employee’s own hourly wage', () => {
    // 時薪 133（底薪 32,000 ÷ 240）：每月上限 46 × 133 = 6,118
    expect(TAX_EXEMPT_OVERTIME_MONTHLY_HOURS).toBe(46);
    expect(calculateMonthlyExemptOvertimePay({ overtimePay: 10000, hourlyWage: 133 })).toBe(6118);
    expect(calculateMonthlyExemptOvertimePay({ overtimePay: 5000, hourlyWage: 133 })).toBe(5000);
  });

  it('does not use any fixed hourly wage', () => {
    // 同樣 10,000 元加班費：時薪 133 與 250 的員工免稅額不同
    expect(calculateMonthlyExemptOvertimePay({ overtimePay: 10000, hourlyWage: 133 })).toBe(6118);
    expect(calculateMonthlyExemptOvertimePay({ overtimePay: 20000, hourlyWage: 250 })).toBe(11500);
  });

  it('compares month by month, so an over-limit month is not offset by unused allowance elsewhere', () => {
    const months = [
      { overtimePay: 20000, hourlyWage: 250 }, // 超過上限 11,500
      ...Array.from({ length: 11 }, () => ({ overtimePay: 0, hourlyWage: 250 })),
    ];

    expect(sumExemptOvertimePay(months)).toBe(11500);
  });

  it('uses each month’s own wage after a mid-year raise', () => {
    expect(
      sumExemptOvertimePay([
        { overtimePay: 10000, hourlyWage: 133 }, // 上限 6,118
        { overtimePay: 10000, hourlyWage: 200 }, // 上限 9,200
      ])
    ).toBe(6118 + 9200);
  });

  it('never returns a negative or non-finite amount', () => {
    expect(calculateMonthlyExemptOvertimePay({ overtimePay: -500, hourlyWage: 133 })).toBe(0);
    expect(calculateMonthlyExemptOvertimePay({ overtimePay: 5000, hourlyWage: 0 })).toBe(0);
    expect(calculateMonthlyExemptOvertimePay({ overtimePay: Number.NaN, hourlyWage: 133 })).toBe(0);
    expect(calculateMonthlyExemptOvertimePay({ overtimePay: 5000, hourlyWage: undefined as never })).toBe(0);
    expect(sumExemptOvertimePay([])).toBe(0);
  });
});
