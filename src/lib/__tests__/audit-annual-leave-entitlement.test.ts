import { calculateAnnualLeaveDaysByTotalMonths, calculateServiceDuration } from '../annual-leave-rules';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const audit = require('../../../scripts/audit-annual-leave-entitlement.cjs') as {
  serviceTotalMonths: (hireDate: Date, referenceDate: Date) => number;
  legalDays: (totalMonths: number) => number;
  legacyDays: (totalMonths: number) => number;
  classify: (row: { year: number; totalDays: number; hireDate: Date }) => { kind: string; legal: number; legacy: number };
};

describe('audit-annual-leave-entitlement script stays in step with the app', () => {
  it('computes the same legal days as the app for every month count', () => {
    for (let months = 0; months <= 600; months += 1) {
      expect(audit.legalDays(months)).toBe(calculateAnnualLeaveDaysByTotalMonths(months));
    }
  });

  it('computes the same service months as the app', () => {
    const hires = ['2016-06-15', '2020-02-29', '2000-12-31', '2025-07-01'];
    const references = ['2026-12-31', '2026-06-14', '2024-02-29', '2030-01-01'];
    for (const hire of hires) {
      for (const reference of references) {
        expect(audit.serviceTotalMonths(new Date(hire), new Date(reference)))
          .toBe(calculateServiceDuration(new Date(hire), new Date(reference)).totalMonths);
      }
    }
  });

  it('knows the old formula was one day short from year 10 to year 23', () => {
    expect(audit.legacyDays(120)).toBe(15);
    expect(audit.legalDays(120)).toBe(16);
    expect(audit.legacyDays(12 * 24)).toBe(29);
    expect(audit.legalDays(12 * 24)).toBe(30);
    expect(audit.legacyDays(12 * 25)).toBe(audit.legalDays(12 * 25));
    expect(audit.legacyDays(108)).toBe(audit.legalDays(108));
  });

  it('classifies stored totals: affected, above legal, other and fine', () => {
    // 2016/06/15 到職，2026 年底滿 10 年 6 個月 → 法定 16、舊公式 15
    const hireDate = new Date(2016, 5, 15);
    expect(audit.classify({ year: 2026, totalDays: 15, hireDate }).kind).toBe('AFFECTED');
    expect(audit.classify({ year: 2026, totalDays: 16, hireDate }).kind).toBe('OK');
    expect(audit.classify({ year: 2026, totalDays: 20, hireDate }).kind).toBe('ABOVE');
    expect(audit.classify({ year: 2026, totalDays: 12, hireDate }).kind).toBe('OTHER');
  });
});
