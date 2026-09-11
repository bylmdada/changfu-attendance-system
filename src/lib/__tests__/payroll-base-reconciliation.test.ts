import { validatePayrollBaseRepairCandidate } from '../payroll-base-reconciliation';

const expected = {
  payrollId: 78,
  employeeNumber: '2026990001',
  payYear: 2026,
  payMonth: 7,
  oldBasePay: 40100,
  newBasePay: 40000,
};

const candidate = {
  payrollId: 78,
  employeeNumber: '2026990001',
  employeeType: 'MONTHLY',
  payYear: 2026,
  payMonth: 7,
  createdAt: new Date('2026-07-01T06:34:15.000Z'),
  employeeUpdatedAt: new Date('2026-07-05T05:03:07.000Z'),
  currentBaseSalary: 40000,
  basePay: 40100,
  overtimePay: 0,
  grossPay: 40100,
  laborInsurance: 1002,
  healthInsurance: 622,
  supplementaryInsurance: 0,
  laborPensionSelf: 0,
  incomeTax: 0,
  totalDeductions: 1624,
  netPay: 38476,
  deductionOther: 0,
  adjustmentCount: 0,
  disputeCount: 0,
  payrollItemCount: 0,
  settlementItemCount: 0,
  salaryHistoryCount: 0,
};

describe('payroll base-pay reconciliation guards', () => {
  it('accepts the verified July snapshot', () => {
    expect(validatePayrollBaseRepairCandidate(candidate, expected)).toEqual([]);
  });

  it('blocks records with financial relations or without the verified edit timeline', () => {
    const blockers = validatePayrollBaseRepairCandidate({
      ...candidate,
      employeeUpdatedAt: new Date('2026-06-30T05:03:07.000Z'),
      adjustmentCount: 1,
      deductionOther: 300,
    }, expected);

    expect(blockers).toEqual(expect.arrayContaining([
      '薪資記錄不是先於員工主檔異動建立',
      '已有薪資調整關聯',
      '包含其他扣除項目',
    ]));
  });
});
