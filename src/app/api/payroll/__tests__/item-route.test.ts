jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/payroll-calculator', () => ({
  calculatePayrollTotals: jest.fn()
}));

jest.mock('@/lib/payroll-processing', () => ({
  buildEmployeePayrollInfo: jest.fn()
}));

jest.mock('@/lib/labor-law-config', () => ({
  getStoredLaborLawConfig: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getStoredLaborLawConfig } from '@/lib/labor-law-config';
import { calculatePayrollTotals } from '@/lib/payroll-calculator';
import { buildEmployeePayrollInfo } from '@/lib/payroll-processing';
import { DELETE, GET, PATCH } from '../[id]/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockGetStoredLaborLawConfig = getStoredLaborLawConfig as jest.MockedFunction<typeof getStoredLaborLawConfig>;
const mockCalculatePayrollTotals = calculatePayrollTotals as jest.MockedFunction<typeof calculatePayrollTotals>;
const mockBuildEmployeePayrollInfo = buildEmployeePayrollInfo as jest.MockedFunction<typeof buildEmployeePayrollInfo>;

describe('payroll item route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockBuildEmployeePayrollInfo.mockResolvedValue({
      id: 5,
      employeeId: 'E005',
      name: '測試員工',
      baseSalary: 32000,
      hourlyRate: 200,
      department: 'HR',
      position: 'Specialist',
      dependents: 0,
      laborPensionSelfRate: 3,
    } as never);
    mockGetStoredLaborLawConfig.mockResolvedValue({
      basicWage: 29500,
      laborInsuranceRate: 0.12,
      laborInsuranceMax: 45800,
      laborEmployeeRate: 0.2,
    });
    mockCalculatePayrollTotals.mockReturnValue({
      grossPay: 39000,
      deductions: {
        laborInsurance: 900,
        healthInsurance: 600,
        supplementaryInsurance: 0,
        laborPensionSelf: 1200,
        incomeTax: 500,
        other: 0,
      },
      totalDeductions: 3200,
      netPay: 35800,
    });
  });

  it('rejects invalid payroll ids on GET before querying prisma', async () => {
    const request = new NextRequest('http://localhost/api/payroll/not-a-number');

    const response = await GET(request, { params: Promise.resolve({ id: 'not-a-number' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的薪資記錄 ID');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rate limits payroll item GET before auth and prisma work', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 15 } as never);

    const request = new NextRequest('http://localhost/api/payroll/12');

    const response = await GET(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toBe('操作過於頻繁，請稍後再試');
    expect(mockGetUserFromRequest).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects mixed payroll ids on GET instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost/api/payroll/12abc');

    const response = await GET(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的薪資記錄 ID');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('requires csrf validation on PATCH requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ basePay: 30000 })
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF token validation failed');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null PATCH bodies before reading payroll records', async () => {
    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.update).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed PATCH JSON before reading payroll records', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.update).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects mixed payroll ids on PATCH before auth-side effects reach prisma', async () => {
    const request = new NextRequest('http://localhost/api/payroll/12abc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ basePay: 30000 })
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的薪資記錄 ID');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.update).not.toHaveBeenCalled();
  });

  it('recalculates deductions and preserves existing bonus when PATCH updates pay amounts', async () => {
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 12,
      employeeId: 5,
      payYear: 2026,
      payMonth: 4,
      basePay: 30000,
      overtimePay: 2000,
      grossPay: 36000,
      employee: {
        id: 5,
        employeeId: 'E005',
        name: '測試員工',
        department: 'HR',
        position: 'Specialist',
        baseSalary: 32000,
        hourlyRate: 200,
        hireDate: new Date('2020-01-01T00:00:00.000Z'),
        dependents: 0,
        insuredBase: 32000,
        laborPensionSelfRate: 3,
        employeeType: 'MONTHLY',
        laborInsuranceActive: true,
        healthInsuranceActive: true,
      },
    } as never);
    mockPrisma.payrollRecord.update.mockResolvedValue({
      id: 12,
      grossPay: 39000,
      netPay: 35800,
      employee: {
        id: 5,
        employeeId: 'E005',
        name: '測試員工',
        department: 'HR',
        position: 'Specialist',
        baseSalary: 32000,
        hourlyRate: 200,
      },
    } as never);

    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ basePay: 33000 })
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockBuildEmployeePayrollInfo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, employeeId: 'E005' }),
      2026,
      4
    );
    expect(mockCalculatePayrollTotals).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'E005' }),
      35000,
      4000,
      expect.objectContaining({
        premiumRate: expect.any(Number),
        exemptThresholdMultiplier: expect.any(Number),
      }),
      {
        basicWage: 29500,
        laborInsuranceRate: 0.12,
        laborInsuranceMax: 45800,
        laborEmployeeRate: 0.2,
      }
    );
    expect(mockPrisma.payrollRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 12 },
        data: expect.objectContaining({
          basePay: 33000,
          grossPay: 39000,
          laborInsurance: 900,
          healthInsurance: 600,
          laborPensionSelf: 1200,
          totalDeductions: 3200,
          netPay: 35800,
        }),
      })
    );
  });

  it('requires csrf validation on DELETE requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'DELETE'
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF token validation failed');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects mixed payroll ids on DELETE instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost/api/payroll/12abc', {
      method: 'DELETE'
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的薪資記錄 ID');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.delete).not.toHaveBeenCalled();
  });
});
