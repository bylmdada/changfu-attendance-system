// 所得稅申報報表與扣繳憑單對同一個人、同一年度，必須算出同一個免稅加班費與應稅所得。
// （曾經一個用固定時薪 200，另一個用第一筆薪資的時薪，同一人差了 9,600 元。）
import { NextRequest } from 'next/server';
import { GET as getTaxDeclaration } from '../tax-declaration/route';
import { GET as getCertificate } from '../withholding-certificate/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: { findMany: jest.fn() },
    employee: { findUnique: jest.fn() },
  },
}));
jest.mock('@/lib/auth', () => ({ getUserFromRequest: jest.fn() }));
jest.mock('@/lib/logoBase64', () => ({ LOGO_BASE64: 'data:image/png;base64,logo' }));
jest.mock('@/lib/encryption', () => ({ decrypt: jest.fn().mockReturnValue('A123456789') }));

const db = prisma as unknown as {
  payrollRecord: { findMany: jest.Mock };
  employee: { findUnique: jest.Mock };
};

function month(payMonth: number, overrides: Record<string, unknown> = {}) {
  return {
    employeeId: 99,
    payMonth,
    basePay: 40000,
    overtimePay: 10000,
    grossPay: 50000,
    laborInsurance: 600,
    healthInsurance: 400,
    laborPensionSelf: 1800,
    incomeTax: 1000,
    netPay: 46200,
    hourlyWage: 250,
    employee: { employeeId: 'E099', name: '測試員工', department: '照護部', hireDate: new Date('2025-03-01T00:00:00Z') },
    ...overrides,
  };
}

async function bothReports(records: Array<ReturnType<typeof month>>) {
  db.payrollRecord.findMany.mockResolvedValue(records);
  const taxResponse = await getTaxDeclaration(new NextRequest('http://localhost/api/reports/tax-declaration?year=2026'));
  const certificateResponse = await getCertificate(
    new NextRequest('http://localhost/api/reports/withholding-certificate?year=2026&employeeId=99')
  );
  const tax = (await taxResponse.json()).records[0];
  const certificate = (await certificateResponse.json()).certificate.totals;
  return { tax, certificate };
}

describe('tax reports agree on exempt overtime and taxable income', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserFromRequest as jest.Mock).mockResolvedValue({ userId: 1, employeeId: 1, username: 'hr', role: 'HR' });
    db.employee.findUnique.mockResolvedValue({
      id: 99, employeeId: 'E099', name: '測試員工', idNumber: 'enc', department: '照護部',
    });
  });

  it('same person, same year, same numbers (12 months × 10,000 overtime at 250/hour)', async () => {
    const { tax, certificate } = await bothReports(Array.from({ length: 12 }, (_, i) => month(i + 1)));

    // 每月上限 46 × 250 = 11,500 ≥ 10,000，全額免稅
    expect(tax.taxExempt).toBe(120000);
    expect(certificate.exemptOvertimePay).toBe(120000);
    expect(tax.taxableIncome).toBe(certificate.taxableIncome);
    expect(certificate.taxableIncome).toBe(446400);
  });

  it('uses the employee’s own hourly wage (133 = 32,000 ÷ 240), not a fixed rate', async () => {
    const { tax, certificate } = await bothReports(
      Array.from({ length: 12 }, (_, i) => month(i + 1, { hourlyWage: 133 }))
    );

    // 每月上限 46 × 133 = 6,118；12 個月 73,416
    expect(tax.taxExempt).toBe(73416);
    expect(certificate.exemptOvertimePay).toBe(73416);
    expect(tax.taxableIncome).toBe(certificate.taxableIncome);
  });

  it('a mid-year raise uses each month’s wage in both reports', async () => {
    const records = [
      ...Array.from({ length: 6 }, (_, i) => month(i + 1, { hourlyWage: 133 })),
      ...Array.from({ length: 6 }, (_, i) => month(i + 7, { hourlyWage: 200 })),
    ];
    const { tax, certificate } = await bothReports(records);

    expect(tax.taxExempt).toBe(6 * 6118 + 6 * 9200);
    expect(certificate.exemptOvertimePay).toBe(tax.taxExempt);
    expect(tax.taxableIncome).toBe(certificate.taxableIncome);
  });

  it('one over-limit month is not hidden by months with unused allowance', async () => {
    const records = [
      month(1, { overtimePay: 20000, grossPay: 60000 }),
      ...Array.from({ length: 11 }, (_, i) => month(i + 2, { overtimePay: 0, grossPay: 40000 })),
    ];
    const { tax, certificate } = await bothReports(records);

    expect(tax.taxExempt).toBe(11500);
    expect(certificate.exemptOvertimePay).toBe(11500);
    expect(tax.taxableIncome).toBe(certificate.taxableIncome);
  });
});
