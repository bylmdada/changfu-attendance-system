import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/salary-management/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { adjustSalary, getSalaryHistory, initializeSalaryHistory } from '@/lib/salary-utils';

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    salaryHistory: {
      count: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/salary-utils', () => ({
  adjustSalary: jest.fn(),
  getSalaryHistory: jest.fn(),
  initializeSalaryHistory: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedAdjustSalary = adjustSalary as jest.MockedFunction<typeof adjustSalary>;
const mockedGetSalaryHistory = getSalaryHistory as jest.MockedFunction<typeof getSalaryHistory>;
const mockedInitializeSalaryHistory = initializeSalaryHistory as jest.MockedFunction<typeof initializeSalaryHistory>;

describe('salary-management route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);

    mockedGetSalaryHistory.mockResolvedValue([] as never);
    mockedInitializeSalaryHistory.mockResolvedValue({ success: true, salaryHistory: { id: 1 } } as never);
    mockedAdjustSalary.mockResolvedValue({
      success: true,
      previousSalary: 40000,
      newBaseSalary: 45000,
      adjustmentAmount: 5000,
      newHourlyRate: 187.5,
    } as never);

    mockedPrisma.employee.findUnique.mockResolvedValue({
      id: 10,
      employeeId: 'E001',
      name: '王小明',
      department: '行政部',
      position: '專員',
      baseSalary: 45000,
      hourlyRate: 187.5,
      hireDate: new Date('2020-01-01'),
    } as never);
    mockedPrisma.employee.findMany.mockResolvedValue([] as never);
    mockedPrisma.salaryHistory.count.mockResolvedValue(0 as never);
  });

  it('rejects history queries when employeeId is not a positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/salary-management?type=history&employeeId=oops');

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '員工ID格式無效' });
    expect(mockedGetSalaryHistory).not.toHaveBeenCalled();
    expect(mockedPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects POST requests with malformed JSON bodies', async () => {
    const request = new NextRequest('http://localhost:3000/api/salary-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
        cookie: 'token=shared-session-token',
      },
      body: '{',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請求內容格式無效' });
    expect(mockedAdjustSalary).not.toHaveBeenCalled();
  });

  it('rejects POST requests when employeeId is not a positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/salary-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        employeeId: 'oops',
        effectiveDate: '2026-04-01',
        newBaseSalary: 45000,
        adjustmentType: 'RAISE',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '員工ID格式無效' });
    expect(mockedAdjustSalary).not.toHaveBeenCalled();
  });

  it('rejects POST requests when newBaseSalary is not a clean numeric amount', async () => {
    const request = new NextRequest('http://localhost:3000/api/salary-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        employeeId: 10,
        effectiveDate: '2026-04-01',
        newBaseSalary: '45000abc',
        adjustmentType: 'RAISE',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '薪資金額格式無效' });
    expect(mockedAdjustSalary).not.toHaveBeenCalled();
  });
});