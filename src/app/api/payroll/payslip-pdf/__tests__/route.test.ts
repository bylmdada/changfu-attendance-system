import { NextRequest } from 'next/server';
import { GET } from '@/app/api/payroll/payslip-pdf/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployeePDFPassword, getPasswordHint, getDefaultSecurityConfig } from '@/lib/pdf-security';

jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      findUnique: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/pdf-security', () => ({
  getEmployeePDFPassword: jest.fn(),
  getPasswordHint: jest.fn(),
  getDefaultSecurityConfig: jest.fn(),
}));

jest.mock('@/lib/logoBase64', () => ({
  LOGO_BASE64: 'data:image/png;base64,test',
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedGetEmployeePDFPassword = getEmployeePDFPassword as jest.MockedFunction<typeof getEmployeePDFPassword>;
const mockedGetPasswordHint = getPasswordHint as jest.MockedFunction<typeof getPasswordHint>;
const mockedGetDefaultSecurityConfig = getDefaultSecurityConfig as jest.MockedFunction<typeof getDefaultSecurityConfig>;

describe('payslip pdf template settings integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 100,
    } as never);
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      payYear: 2026,
      payMonth: 4,
      regularHours: 160,
      overtimeHours: 8,
      basePay: 32000,
      overtimePay: 2000,
      grossPay: 34000,
      laborInsurance: 500,
      healthInsurance: 600,
      supplementaryInsurance: 0,
      incomeTax: 200,
      totalDeductions: 1300,
      netPay: 32700,
      adjustments: [],
      employee: {
        id: 10,
        employeeId: 'E001',
        name: '王小明',
        department: '製造部',
        position: '照服員',
        baseSalary: 32000,
      },
    } as never);
    mockedGetDefaultSecurityConfig.mockReturnValue({
      passwordProtected: false,
      passwordType: 'none',
    });
    mockedGetEmployeePDFPassword.mockResolvedValue('990101' as never);
    mockedGetPasswordHint.mockReturnValue('birthday');
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'payslip_templates',
      value: JSON.stringify([
        {
          id: 1,
          isDefault: true,
          securityConfig: {
            passwordProtected: true,
            passwordType: 'birthday',
          },
        },
      ]),
    } as never);
  });

  it('loads the default template security config from payslip_templates', async () => {
    const request = new NextRequest('http://localhost:3000/api/payroll/payslip-pdf?payrollId=1');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.security).toEqual(
      expect.objectContaining({
        hasPassword: true,
        password: '990101',
        hint: 'birthday',
      })
    );
    expect(mockPrisma.systemSettings.findUnique).toHaveBeenCalledWith({
      where: { key: 'payslip_templates' },
    });
  });

  it('rejects mixed payroll ids before querying the database', async () => {
    const request = new NextRequest('http://localhost:3000/api/payroll/payslip-pdf?payrollId=12abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('薪資記錄ID格式無效');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('renders payroll dispute adjustments into the payslip html', async () => {
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      payYear: 2026,
      payMonth: 4,
      regularHours: 160,
      overtimeHours: 8,
      basePay: 32000,
      overtimePay: 2000,
      grossPay: 34500,
      laborInsurance: 500,
      healthInsurance: 600,
      supplementaryInsurance: 0,
      incomeTax: 200,
      totalDeductions: 1600,
      netPay: 32900,
      adjustments: [
        { id: 1, type: 'SUPPLEMENT', description: '3月加班費補發', amount: 500 },
        { id: 2, type: 'DEDUCTION', description: '重複津貼扣回', amount: 300 },
      ],
      employee: {
        id: 10,
        employeeId: 'E001',
        name: '王小明',
        department: '製造部',
        position: '照服員',
        baseSalary: 32000,
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/payroll/payslip-pdf?payrollId=1');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.htmlContent).toContain('3月加班費補發');
    expect(payload.htmlContent).toContain('重複津貼扣回');
  });

  it('escapes employee and adjustment text before rendering html', async () => {
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 10,
      payYear: 2026,
      payMonth: 4,
      regularHours: 160,
      overtimeHours: 8,
      basePay: 32000,
      overtimePay: 2000,
      grossPay: 34500,
      laborInsurance: 500,
      healthInsurance: 600,
      supplementaryInsurance: 0,
      incomeTax: 200,
      totalDeductions: 1600,
      netPay: 32900,
      adjustments: [
        { id: 1, type: 'SUPPLEMENT', description: '<script>alert(1)</script>', amount: 500 },
      ],
      employee: {
        id: 10,
        employeeId: 'E001',
        name: '<img src=x onerror=alert(1)>',
        department: '研發 & <b>測試</b>',
        position: '工程師',
        baseSalary: 32000,
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/payroll/payslip-pdf?payrollId=1');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.htmlContent).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(payload.htmlContent).toContain('研發 &amp; &lt;b&gt;測試&lt;/b&gt;');
    expect(payload.htmlContent).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(payload.htmlContent).not.toContain('<script>alert(1)</script>');
    expect(payload.htmlContent).not.toContain('<img src=x onerror=alert(1)>');
  });
});
