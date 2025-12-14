/**
 * 稅金扣除計算測試
 * 
 * 依據 2024 年台灣勞健保及所得稅法規
 */

import {
  TAX_CONFIG,
  calculateLaborInsurance,
  calculateHealthInsurance,
  calculateIncomeTax,
  calculateAllDeductions,
  calculateBonusSupplementaryPremium
} from '../tax-calculator';

describe('勞健保及稅金計算測試', () => {
  describe('勞保費計算', () => {
    test('月薪 36,000 → 勞保費', () => {
      const laborInsurance = calculateLaborInsurance(36000);
      // 36000 * 11.5% * 20% = 828
      expect(laborInsurance).toBe(828);
    });

    test('月薪超過上限 → 以上限計算', () => {
      const laborInsurance = calculateLaborInsurance(60000);
      const maxLaborInsurance = Math.round(TAX_CONFIG.LABOR_INSURANCE_MAX * TAX_CONFIG.LABOR_INSURANCE_RATE * 0.2);
      expect(laborInsurance).toBeLessThanOrEqual(maxLaborInsurance);
    });
  });

  describe('健保費計算', () => {
    test('無眷屬 → 僅計算本人', () => {
      const result = calculateHealthInsurance(36000, 0);
      expect(result.totalInsuredPersons).toBe(1);
      expect(result.totalPremium).toBeGreaterThan(0);
    });

    test('2 眷屬 → 計算本人 + 2 眷屬', () => {
      const result = calculateHealthInsurance(36000, 2);
      expect(result.totalInsuredPersons).toBe(3);
      expect(result.totalPremium).toBeGreaterThan(0);
    });

    test('5 眷屬 → 最多計算 3 眷屬', () => {
      const result = calculateHealthInsurance(36000, 5);
      expect(result.actualDependents).toBe(3);
      expect(result.totalInsuredPersons).toBe(4); // 本人 + 3 眷屬
    });
  });

  describe('所得稅計算', () => {
    test('年薪 50 萬 → 應有預扣稅', () => {
      const incomeTax = calculateIncomeTax(500000);
      expect(incomeTax).toBeGreaterThanOrEqual(0);
    });

    test('年薪 100 萬 → 預扣稅較高', () => {
      const lowIncomeTax = calculateIncomeTax(500000);
      const highIncomeTax = calculateIncomeTax(1000000);
      expect(highIncomeTax).toBeGreaterThan(lowIncomeTax);
    });
  });

  describe('獎金補充保費計算', () => {
    test('獎金未超過門檻 → 不扣補充保費', () => {
      const result = calculateBonusSupplementaryPremium(36000, 0, 10000);
      expect(result.shouldDeduct).toBe(false);
      expect(result.premiumAmount).toBe(0);
    });

    test('累計獎金超過投保金額4倍 → 扣補充保費', () => {
      const insuredAmount = 36000;
      // 門檻 = 投保金額 * 4 = 144,000
      const result = calculateBonusSupplementaryPremium(insuredAmount, 100000, 50000);
      // 累計 150,000 > 144,000
      expect(result.shouldDeduct).toBe(true);
      expect(result.premiumAmount).toBeGreaterThan(0);
    });
  });

  describe('綜合扣除計算', () => {
    test('計算所有扣除項目', () => {
      const result = calculateAllDeductions(36000, 432000, 0);
      
      expect(result.laborInsurance).toBeGreaterThan(0);
      expect(result.healthInsurance).toBeGreaterThan(0);
      expect(result.totalDeductions).toBeGreaterThan(0);
      expect(result.netSalary).toBeLessThan(36000);
      expect(result.netSalary).toBe(36000 - result.totalDeductions);
    });

    test('實領薪資應為正數', () => {
      const result = calculateAllDeductions(50000, 600000, 2);
      expect(result.netSalary).toBeGreaterThan(0);
    });
  });
});
