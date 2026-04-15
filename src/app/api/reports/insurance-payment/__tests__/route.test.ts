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