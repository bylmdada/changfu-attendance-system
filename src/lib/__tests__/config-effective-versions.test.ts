jest.mock('@/lib/database', () => ({
  prisma: {
    laborLawConfig: { findFirst: jest.fn() },
    leaveRulesConfig: { findFirst: jest.fn() },
    healthInsuranceConfig: { findFirst: jest.fn() },
  },
}));

import { prisma } from '@/lib/database';
import { getStoredLaborLawConfig } from '@/lib/labor-law-config';
import { getLeaveRulesConfig } from '@/lib/leave-rules-validator';
import { getStoredHealthInsuranceFormulaConfig } from '@/lib/health-insurance-config';
import { DEFAULT_LABOR_LAW_CONFIG } from '@/lib/labor-law-config-defaults';
import { DEFAULT_LEAVE_RULES_SETTINGS } from '@/lib/leave-rules-config-defaults';
import { DEFAULT_HEALTH_INSURANCE_FORMULA } from '@/lib/health-insurance-config';

type Row = { id: number; effectiveDate: Date; isActive: boolean } & Record<string, unknown>;
type Query = {
  where: { isActive: boolean; effectiveDate: { lte: Date } };
  orderBy: Array<{ effectiveDate?: 'desc'; id?: 'desc' }>;
};

// 照 where／orderBy 的語意模擬資料庫挑版本：啟用中、生效日不晚於查詢日，生效日較晚的優先
const pickVersion = (rows: Row[]) => async ({ where, orderBy }: Query) => {
  const candidates = rows
    .filter((row) => row.isActive === where.isActive && row.effectiveDate.getTime() <= where.effectiveDate.lte.getTime())
    .sort((a, b) => {
      for (const order of orderBy) {
        if (order.effectiveDate) {
          const diff = b.effectiveDate.getTime() - a.effectiveDate.getTime();
          if (diff !== 0) return diff;
        }
        if (order.id) {
          const diff = b.id - a.id;
          if (diff !== 0) return diff;
        }
      }
      return 0;
    });
  return candidates[0] ?? null;
};

const mockPrisma = prisma as unknown as {
  laborLawConfig: { findFirst: jest.Mock };
  leaveRulesConfig: { findFirst: jest.Mock };
  healthInsuranceConfig: { findFirst: jest.Mock };
};

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe('configuration versions are chosen by effective date', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-25T04:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('labor law parameters', () => {
    const labor = (id: number, effectiveDate: string, basicWage: number): Row => ({
      id, effectiveDate: day(effectiveDate), isActive: true, basicWage,
      laborInsuranceRate: 0.12, employmentInsuranceRate: 0.01, laborInsuranceMax: 45800, laborEmployeeRate: 0.2,
    });

    beforeEach(() => {
      mockPrisma.laborLawConfig.findFirst.mockImplementation(pickVersion([
        labor(1, '2025-01-01', 27470),
        labor(2, '2026-01-01', 28590),
        labor(3, '2030-01-01', 30000), // 預排的未來版本
      ]));
    });

    it('does not apply a scheduled version before its effective date', async () => {
      expect((await getStoredLaborLawConfig()).basicWage).toBe(28590);
      expect((await getStoredLaborLawConfig(day('2029-12-31'))).basicWage).toBe(28590);
    });

    it('treats the whole Taipei effective day as in effect, including the small hours before 08:00', async () => {
      mockPrisma.laborLawConfig.findFirst.mockImplementation(pickVersion([
        labor(1, '2026-01-01', 28590),
        labor(2, '2026-11-25', 29000),
      ]));
      jest.setSystemTime(new Date('2026-11-24T19:00:00.000Z')); // 台北 11/25 03:00

      expect((await getStoredLaborLawConfig()).basicWage).toBe(29000);

      jest.setSystemTime(new Date('2026-11-24T15:59:00.000Z')); // 台北 11/24 23:59，前一天
      expect((await getStoredLaborLawConfig()).basicWage).toBe(28590);
    });

    it('applies the scheduled version from its effective date on', async () => {
      expect((await getStoredLaborLawConfig(day('2030-01-01'))).basicWage).toBe(30000);
    });

    it('returns the version that applied to an older period when recomputing it', async () => {
      expect((await getStoredLaborLawConfig(day('2025-06-30'))).basicWage).toBe(27470);
      expect((await getStoredLaborLawConfig(day('2026-01-01'))).basicWage).toBe(28590);
    });

    it('falls back to the defaults before the first version', async () => {
      expect(await getStoredLaborLawConfig(day('2024-12-31'))).toEqual(DEFAULT_LABOR_LAW_CONFIG);
    });
  });

  describe('leave rules', () => {
    const rules = (id: number, effectiveDate: string, compLeaveExpiryMonths: number): Row => ({
      id, effectiveDate: day(effectiveDate), isActive: true, compLeaveExpiryMonths,
      parentalLeaveFlexible: true, parentalLeaveMaxDays: 30, parentalLeaveCombinedMax: 60,
      familyCareLeaveMaxDays: 7, familyCareHourlyEnabled: true, familyCareHourlyMaxHours: 56,
      familyCareNoDeductAttendance: true, sickLeaveAnnualMax: 30, sickLeaveNoDeductDays: 10, sickLeaveHalfPay: true,
      annualLeaveRollover: false, annualLeaveRolloverMax: 0, compLeaveRollover: false, compLeaveRolloverMax: 0,
    });

    beforeEach(() => {
      mockPrisma.leaveRulesConfig.findFirst.mockImplementation(pickVersion([
        rules(1, '2025-01-01', 6),
        rules(2, '2030-01-01', 12),
      ]));
    });

    it('keeps the current rules until the scheduled version takes effect', async () => {
      expect((await getLeaveRulesConfig()).compLeaveExpiryMonths).toBe(6);
      expect((await getLeaveRulesConfig(day('2029-12-31'))).compLeaveExpiryMonths).toBe(6);
      expect((await getLeaveRulesConfig(day('2030-01-01'))).compLeaveExpiryMonths).toBe(12);
    });

    it('uses the defaults before the first version', async () => {
      expect(await getLeaveRulesConfig(day('2024-01-01'))).toEqual(DEFAULT_LEAVE_RULES_SETTINGS);
    });
  });

  describe('health insurance formula', () => {
    const formula = (id: number, effectiveDate: string, premiumRate: number): Row => ({
      id, effectiveDate: day(effectiveDate), isActive: true, premiumRate,
      employeeContributionRatio: 0.3, companyContributionRatio: 0.6, governmentSubsidyRatio: 0.1, maxDependents: 3,
      salaryLevels: [],
    });

    beforeEach(() => {
      mockPrisma.healthInsuranceConfig.findFirst.mockImplementation(pickVersion([
        formula(1, '2026-01-01', 0.0517),
        formula(2, '2030-01-01', 0.06),
      ]));
    });

    it('keeps the current formula until the scheduled version takes effect', async () => {
      expect((await getStoredHealthInsuranceFormulaConfig()).premiumRate).toBe(0.0517);
      expect((await getStoredHealthInsuranceFormulaConfig(day('2030-01-01'))).premiumRate).toBe(0.06);
    });

    it('uses the defaults before the first version', async () => {
      expect((await getStoredHealthInsuranceFormulaConfig(day('2025-12-31'))).premiumRate)
        .toBe(DEFAULT_HEALTH_INSURANCE_FORMULA.premiumRate);
    });
  });
});
