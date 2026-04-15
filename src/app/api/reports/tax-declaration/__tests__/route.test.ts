import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { cookies } from 'next/headers';

jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
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

describe('tax declaration report route auth guards', () => {
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

    mockedPrisma.payrollRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        payMonth: 1,
        basePay: 30000,
        overtimePay: 2000,
        grossPay: 32000,
        laborInsurance: 700,
        healthInsurance: 500,
        laborPensionSelf: 1800,
        incomeTax: 600,
        netPay: 28400,
        employee: {
          employeeId: 'EMP001',
          name: '王小明',
          department: 'HR',
          hireDate: new Date('2025-01-10T00:00:00.000Z'),
        },
      },
    ] as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost/api/reports/tax-declaration?year=2026', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.summary.totalEmployees).toBe(1);
  });

  it('neutralizes spreadsheet formulas in CSV exports', async () => {
    mockedPrisma.payrollRecord.findMany.mockResolvedValueOnce([
      {
        employeeId: 1,
        payMonth: 1,
        basePay: 30000,
        overtimePay: 2000,
        grossPay: 32000,
        laborInsurance: 700,
        healthInsurance: 500,
        laborPensionSelf: 1800,
        incomeTax: 600,
        netPay: 28400,
        employee: {
          employeeId: '=EMP001',
          name: '王小明',
          department: 'HR',
          hireDate: new Date('2025-01-10T00:00:00.000Z'),
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/reports/tax-declaration?year=2026&format=csv', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const csvContent = await response.text();

    expect(response.status).toBe(200);
    expect(csvContent).toContain("'=EMP001");
    expect(csvContent).not.toContain(',=EMP001,');
  });

  it('returns 400 for an invalid year query param', async () => {
    const request = new NextRequest('http://localhost/api/reports/tax-declaration?year=abc', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的年份參數' });
    expect(mockedPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid format query param', async () => {
    const request = new NextRequest('http://localhost/api/reports/tax-declaration?year=2026&format=xml', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的格式參數' });
    expect(mockedPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });
});