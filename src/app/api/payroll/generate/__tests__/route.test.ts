jest.mock('@/lib/database', () => ({
  prisma: {
    holiday: {
      findMany: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
    payrollRecord: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
    bonusConfiguration: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/payroll-calculator', () => ({
  calculateMonthlyPayroll: jest.fn(),
  validatePayrollCalculation: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('payroll generate route', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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
});