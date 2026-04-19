import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { cookies } from 'next/headers';

jest.mock('@/lib/database', () => ({
  prisma: {
    laborLawConfig: {
      findFirst: jest.fn(),
    },
    healthInsuranceConfig: {
      findFirst: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn(),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockedCookies = cookies as jest.MockedFunction<typeof cookies>;

describe('insurance payment report route auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedCookies.mockResolvedValue({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    });

    mockedGetUserFromToken.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    });

    mockedPrisma.laborLawConfig.findFirst.mockResolvedValue(null as never);
    mockedPrisma.healthInsuranceConfig.findFirst.mockResolvedValue(null as never);
    mockedPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'EMP001',
        name: '王小明',
        department: 'HR',
        baseSalary: 40000,
        insuredBase: 40000,
        dependents: 1,
        healthInsuranceActive: true,
      },
    ] as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost/api/reports/insurance-payment?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.records).toHaveLength(1);
  });

  it('neutralizes spreadsheet formulas in CSV exports', async () => {
    mockedPrisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 1,
        employeeId: 'EMP001',
        name: '王小明',
        department: '+HR',
        baseSalary: 40000,
        insuredBase: 40000,
        dependents: 1,
        healthInsuranceActive: true,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/reports/insurance-payment?year=2026&month=3&format=csv', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const csvContent = await response.text();

    expect(response.status).toBe(200);
    expect(csvContent).toContain("'+HR");
    expect(csvContent).not.toContain(',+HR,');
  });

  it('zeros health insurance amounts when employee health insurance is inactive', async () => {
    mockedPrisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 1,
        employeeId: 'EMP001',
        name: '王小明',
        department: 'HR',
        baseSalary: 40000,
        insuredBase: 40000,
        dependents: 2,
        healthInsuranceActive: false,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/reports/insurance-payment?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.records[0]).toMatchObject({
      isHealthActive: false,
      healthInsuredAmount: 0,
      dependents: 0,
      totalPersons: 0,
      healthEmployee: 0,
      healthEmployer: 0,
      healthTotal: 0,
    });
  });

  it('uses configured health insurance salary levels when an active formula exists', async () => {
    mockedPrisma.healthInsuranceConfig.findFirst.mockResolvedValueOnce({
      premiumRate: 0.0517,
      employeeContributionRatio: 0.3,
      maxDependents: 3,
      salaryLevels: [
        { level: 1, minSalary: 0, maxSalary: 50000, insuredAmount: 40100 },
        { level: 2, minSalary: 50001, maxSalary: 999999999, insuredAmount: 62000 },
      ],
    } as never);

    const request = new NextRequest('http://localhost/api/reports/insurance-payment?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.records[0]).toMatchObject({
      healthInsuredAmount: 40100,
    });
  });

  it('caps labor insured amount with the configured labor insurance maximum', async () => {
    mockedPrisma.laborLawConfig.findFirst.mockResolvedValueOnce({
      laborInsuranceRate: 0.115,
      laborInsuranceMax: 30000,
      laborEmployeeRate: 0.2,
    } as never);

    mockedPrisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 1,
        employeeId: 'EMP001',
        name: '王小明',
        department: 'HR',
        baseSalary: 50000,
        insuredBase: 50000,
        dependents: 1,
        healthInsuranceActive: true,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/reports/insurance-payment?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.records[0]).toMatchObject({
      laborInsuredAmount: 30300,
    });
  });

  it.each([
    ['http://localhost/api/reports/insurance-payment?year=abc&month=3', '無效的年份參數'],
    ['http://localhost/api/reports/insurance-payment?year=2026&month=13', '無效的月份參數'],
    ['http://localhost/api/reports/insurance-payment?year=2026&month=3&format=xml', '無效的格式參數'],
  ])('returns 400 for invalid query params: %s', async (url, expectedError) => {
    const request = new NextRequest(url, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: expectedError });
    expect(mockedPrisma.laborLawConfig.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
  });
});
