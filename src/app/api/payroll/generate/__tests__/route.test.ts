jest.mock('@/lib/database', () => ({
  prisma: {
    holiday: {
      findMany: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
    pensionContributionApplication: {
      findFirst: jest.fn(),
    },
    payrollDispute: {
      findMany: jest.fn(),
    },
    payrollRecord: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    payrollAdjustment: {
      create: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
    bonusConfiguration: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/payroll-calculator', () => ({
  calculateMonthlyPayroll: jest.fn(),
  calculatePayrollTotals: jest.fn(),
  normalizeDependentsCount: jest.fn((dependents: unknown) =>
    typeof dependents === 'number' && Number.isFinite(dependents)
      ? Math.min(Math.max(Math.trunc(dependents), 0), 10)
      : 0
  ),
  validatePayrollCalculation: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  calculateMonthlyPayroll,
  calculatePayrollTotals,
  validatePayrollCalculation,
} from '@/lib/payroll-calculator';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockCalculateMonthlyPayroll = calculateMonthlyPayroll as jest.MockedFunction<typeof calculateMonthlyPayroll>;
const mockCalculatePayrollTotals = calculatePayrollTotals as jest.MockedFunction<typeof calculatePayrollTotals>;
const mockValidatePayrollCalculation = validatePayrollCalculation as jest.MockedFunction<typeof validatePayrollCalculation>;

describe('payroll generate route', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'hr-admin',
      role: 'HR',
      employeeId: 9001,
    } as never);

    mockPrisma.holiday.findMany.mockResolvedValue([] as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.bonusConfiguration.findMany.mockResolvedValue([] as never);
    mockPrisma.pensionContributionApplication.findFirst.mockResolvedValue(null as never);
    mockPrisma.payrollDispute.findMany.mockResolvedValue([] as never);
    mockPrisma.payrollAdjustment.create.mockResolvedValue({ id: 91 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma as never) as never);
    mockCalculatePayrollTotals.mockReturnValue({
      grossPay: 40000,
      deductions: {
        laborInsurance: 0,
        healthInsurance: 0,
        supplementaryInsurance: 0,
        laborPensionSelf: 1200,
        incomeTax: 0,
        other: 0,
      },
      totalDeductions: 1200,
      netPay: 38800,
    });
    mockValidatePayrollCalculation.mockReturnValue({ isValid: true, errors: [] });
  });

  it('applies rate limiting before generation starts', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 45 } as never);

    const request = new NextRequest('http://localhost/api/payroll/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payYear: 2025, payMonth: 4 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toBe('操作過於頻繁，請稍後再試');
    expect(mockValidateCSRF).not.toHaveBeenCalled();
    expect(mockPrisma.holiday.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 when every selected employee already has a payroll record', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 101,
        employeeId: 'EMP001',
        name: '王小明',
        department: '行政部',
        position: '專員',
        baseSalary: 40000,
        hourlyRate: 250,
        dependents: 0,
        insuredBase: 40000,
        laborPensionSelfRate: 0,
        employeeType: 'MONTHLY',
        laborInsuranceActive: true,
        healthInsuranceActive: true,
        hireDate: new Date('2020-01-01T00:00:00.000Z'),
        isActive: true,
      },
    ] as never);

    mockPrisma.payrollRecord.findFirst.mockResolvedValue({
      id: 5001,
    } as never);

    const request = new NextRequest('http://localhost/api/payroll/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        payYear: 2024,
        payMonth: 8,
        employeeIds: [101],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('薪資記錄已存在');
    expect(payload.errors).toEqual([
      '員工 王小明 (EMP001) 的 2024年8月 薪資記錄已存在',
    ]);
    expect(payload.success).toBeUndefined();
  });

  it('uses the latest approved pension rate that is effective for the payroll month', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 101,
        employeeId: 'EMP001',
        name: '王小明',
        department: '行政部',
        position: '專員',
        baseSalary: 40000,
        hourlyRate: 250,
        dependents: 0,
        insuredBase: 40000,
        laborPensionSelfRate: 1,
        employeeType: 'MONTHLY',
        laborInsuranceActive: true,
        healthInsuranceActive: true,
        hireDate: new Date('2020-01-01T00:00:00.000Z'),
        isActive: true,
      },
    ] as never);
    mockPrisma.payrollRecord.findFirst.mockResolvedValue(null as never);
    mockPrisma.pensionContributionApplication.findFirst.mockResolvedValue({
      requestedRate: 3,
    } as never);
    mockCalculateMonthlyPayroll.mockReturnValue({
      employeeId: 101,
      payYear: 2024,
      payMonth: 8,
      regularHours: 160,
      totalOvertimeHours: 0,
      overtimeBreakdown: {
        weekdayHours: 0,
        restDayHours: 0,
        holidayHours: 0,
        mandatoryRestHours: 0,
      },
      basePay: 40000,
      hourlyWage: 250,
      totalOvertimePay: 0,
      grossPay: 40000,
      deductions: {
        laborInsurance: 0,
        healthInsurance: 0,
        supplementaryInsurance: 0,
        laborPensionSelf: 1200,
        incomeTax: 0,
        other: 0,
      },
      totalDeductions: 1200,
      netPay: 38800,
      overtimeDetails: [],
      calculationNotes: [],
    });
    mockPrisma.payrollRecord.create.mockResolvedValue({
      id: 5002,
      employee: {
        id: 101,
        employeeId: 'EMP001',
        name: '王小明',
        department: '行政部',
        position: '專員',
      },
    } as never);

    const request = new NextRequest('http://localhost/api/payroll/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        payYear: 2024,
        payMonth: 8,
        employeeIds: [101],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockCalculateMonthlyPayroll).toHaveBeenCalledWith(
      expect.objectContaining({
        laborPensionSelfRate: 3,
      }),
      expect.any(Array),
      2024,
      8
    );
  });

  it('creates payroll adjustments for approved disputes that are waiting on payroll generation', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 101,
        employeeId: 'EMP001',
        name: '王小明',
        department: '行政部',
        position: '專員',
        baseSalary: 40000,
        hourlyRate: 250,
        dependents: 0,
        insuredBase: 40000,
        laborPensionSelfRate: 0,
        employeeType: 'MONTHLY',
        laborInsuranceActive: true,
        healthInsuranceActive: true,
        hireDate: new Date('2020-01-01T00:00:00.000Z'),
        isActive: true,
      },
    ] as never);
    mockPrisma.payrollRecord.findFirst.mockResolvedValue(null as never);
    mockPrisma.payrollDispute.findMany.mockResolvedValue([
      {
        id: 88,
        payYear: 2024,
        payMonth: 7,
        type: 'DEDUCTION_ERROR',
        adjustedAmount: -500,
        reviewNote: '扣回重複發放',
      },
    ] as never);
    mockCalculateMonthlyPayroll.mockReturnValue({
      employeeId: 101,
      payYear: 2024,
      payMonth: 8,
      regularHours: 160,
      totalOvertimeHours: 0,
      overtimeBreakdown: {
        weekdayHours: 0,
        restDayHours: 0,
        holidayHours: 0,
        mandatoryRestHours: 0,
      },
      basePay: 40000,
      hourlyWage: 250,
      totalOvertimePay: 0,
      grossPay: 40000,
      deductions: {
        laborInsurance: 0,
        healthInsurance: 0,
        supplementaryInsurance: 0,
        laborPensionSelf: 1200,
        incomeTax: 0,
        other: 0,
      },
      totalDeductions: 1200,
      netPay: 38800,
      overtimeDetails: [],
      calculationNotes: [],
    });
    mockPrisma.payrollRecord.create.mockResolvedValue({
      id: 5003,
      employee: {
        id: 101,
        employeeId: 'EMP001',
        name: '王小明',
        department: '行政部',
        position: '專員',
      },
    } as never);

    const request = new NextRequest('http://localhost/api/payroll/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        payYear: 2024,
        payMonth: 8,
        employeeIds: [101],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.payrollRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        grossPay: 40000,
        totalDeductions: 1700,
        netPay: 38300,
        calculationNotes: ['薪資異議扣除：NT$ 500（扣回重複發放）'],
      }),
    }));
    expect(mockPrisma.payrollAdjustment.create).toHaveBeenCalledWith({
      data: {
        payrollId: 5003,
        disputeId: 88,
        type: 'DEDUCTION',
        category: 'OTHER',
        description: '扣回重複發放',
        amount: 500,
        originalYear: 2024,
        originalMonth: 7,
        createdBy: 9001,
      },
    });
  });
});
