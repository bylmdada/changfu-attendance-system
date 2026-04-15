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
});