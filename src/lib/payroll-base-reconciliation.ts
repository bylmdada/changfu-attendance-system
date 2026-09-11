export interface ExpectedPayrollBaseRepair {
  payrollId: number;
  employeeNumber: string;
  payYear: number;
  payMonth: number;
  oldBasePay: number;
  newBasePay: number;
}

export interface PayrollBaseRepairCandidate {
  payrollId: number;
  employeeNumber: string;
  employeeType: string | null;
  payYear: number;
  payMonth: number;
  createdAt: Date;
  employeeUpdatedAt: Date;
  currentBaseSalary: number;
  basePay: number;
  overtimePay: number;
  grossPay: number;
  laborInsurance: number;
  healthInsurance: number;
  supplementaryInsurance: number;
  laborPensionSelf: number;
  incomeTax: number;
  totalDeductions: number;
  netPay: number;
  deductionOther: number;
  adjustmentCount: number;
  disputeCount: number;
  payrollItemCount: number;
  settlementItemCount: number;
  salaryHistoryCount: number;
}

function sameMoney(left: number, right: number) {
  return Math.abs(left - right) < 0.005;
}

export function validatePayrollBaseRepairCandidate(
  candidate: PayrollBaseRepairCandidate,
  expected: ExpectedPayrollBaseRepair
): string[] {
  const blockers: string[] = [];

  if (candidate.payrollId !== expected.payrollId) blockers.push('薪資記錄 ID 不符');
  if (candidate.employeeNumber !== expected.employeeNumber) blockers.push('員工編號不符');
  if (candidate.payYear !== expected.payYear || candidate.payMonth !== expected.payMonth) blockers.push('薪資月份不符');
  if (candidate.employeeType !== 'MONTHLY') blockers.push('不是月薪制員工');
  if (!sameMoney(candidate.basePay, expected.oldBasePay)) blockers.push('原薪資快照已變更');
  if (!sameMoney(candidate.currentBaseSalary, expected.newBasePay)) blockers.push('員工目前底薪已變更');
  if (candidate.createdAt >= candidate.employeeUpdatedAt) blockers.push('薪資記錄不是先於員工主檔異動建立');
  if (!sameMoney(candidate.overtimePay, 0)) blockers.push('包含加班費');
  if (!sameMoney(candidate.grossPay, candidate.basePay + candidate.overtimePay)) blockers.push('包含獎金或其他應發項目');
  if (candidate.adjustmentCount > 0) blockers.push('已有薪資調整關聯');
  if (candidate.disputeCount > 0) blockers.push('已有薪資異議關聯');
  if (candidate.payrollItemCount > 0) blockers.push('已有自訂薪資項目');
  if (candidate.settlementItemCount > 0) blockers.push('已有結算項目');
  if (candidate.salaryHistoryCount > 0) blockers.push('已有有效日薪資歷史');
  if (!sameMoney(candidate.deductionOther, 0)) blockers.push('包含其他扣除項目');

  const componentDeductions = candidate.laborInsurance
    + candidate.healthInsurance
    + candidate.supplementaryInsurance
    + candidate.laborPensionSelf
    + candidate.incomeTax;
  if (!sameMoney(candidate.totalDeductions, componentDeductions)) blockers.push('扣除合計含有未辨識項目');
  if (!sameMoney(candidate.netPay, candidate.grossPay - candidate.totalDeductions)) blockers.push('實領薪資與快照金額不一致');

  return blockers;
}
