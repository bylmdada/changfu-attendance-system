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
  getDefaultSecurityConfig: jest.fn(() => ({ passwordProtected: false, passwordType: 'none' })),
}));

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { execFile } from 'child_process';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployeePDFPassword, getDefaultSecurityConfig } from '@/lib/pdf-security';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetEmployeePDFPassword = getEmployeePDFPassword as jest.MockedFunction<typeof getEmployeePDFPassword>;
const mockGetDefaultSecurityConfig = getDefaultSecurityConfig as jest.MockedFunction<typeof getDefaultSecurityConfig>;
const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

describe('payroll payslip download route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
  });

  it('rejects mixed payroll ids before querying prisma', async () => {
    const request = new NextRequest('http://localhost/api/payroll/payslip-download?payrollId=12abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('薪資記錄ID格式無效');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when qpdf encryption fails and passes password as a raw execFile arg', async () => {
    mockGetDefaultSecurityConfig.mockReturnValue({
      passwordProtected: false,
      passwordType: 'none',
    });
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'payslip_templates',
      value: JSON.stringify([
        {
          id: 1,
          isDefault: true,
          securityConfig: {
            passwordProtected: true,
            passwordType: 'custom',
            customPassword: 'ignored-by-mock',
          },
        },
      ]),
    } as never);
    mockGetEmployeePDFPassword.mockResolvedValue('p@"ss;$HOME' as never);
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 1,
      payYear: 2026,
      payMonth: 4,
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
        id: 1,
        employeeId: 'E001',
        name: 'Alice Wang',
        department: 'Operations',
        position: 'Staff',
      },
    } as never);
    mockExecFile.mockImplementation((file, args, callback) => {
      callback?.(new Error('qpdf failed'), '', '');
      return {} as never;
    });

    const request = new NextRequest('http://localhost/api/payroll/payslip-download?payrollId=1');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('系統錯誤');
    expect(mockExecFile).toHaveBeenCalledWith(
      'qpdf',
      [
        '--encrypt',
        'p@"ss;$HOME',
        'p@"ss;$HOME',
        '256',
        '--',
        expect.any(String),
        expect.any(String),
      ],
      expect.any(Function)
    );
  });
});
