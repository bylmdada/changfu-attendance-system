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

describe('bank transfer report route auth guards', () => {
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
        payYear: 2026,
        payMonth: 3,
        grossPay: 42000,
        totalDeductions: 3000,
        netPay: 39000,
        employee: {
          id: 1,
          employeeId: 'EMP001',
          name: '王小明',
          department: 'HR',
          bankAccount: '123456789012',
        },
      },
    ] as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost/api/reports/bank-transfer?year=2026&month=3', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.summary.totalRecords).toBe(1);
    expect(data.records[0].bankAccount).toBe('123456789012');
  });

  it('neutralizes spreadsheet formulas in CSV exports', async () => {
    mockedPrisma.payrollRecord.findMany.mockResolvedValueOnce([
      {
        employeeId: 1,
        payYear: 2026,
        payMonth: 3,
        grossPay: 42000,
        totalDeductions: 3000,
        netPay: 39000,
        employee: {
          id: 1,
          employeeId: 'EMP001',
          name: '=SUM(1+2)',
          department: 'HR',
          bankAccount: '123456789012',
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/reports/bank-transfer?year=2026&month=3&format=csv', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const csvContent = await response.text();

    expect(response.status).toBe(200);
    expect(csvContent).toContain("'=SUM(1+2)");
    expect(csvContent).not.toContain(',=SUM(1+2),');
  });

  it.each([
    ['http://localhost/api/reports/bank-transfer?year=abc&month=3', '無效的年份參數'],
    ['http://localhost/api/reports/bank-transfer?year=2026&month=13', '無效的月份參數'],
    ['http://localhost/api/reports/bank-transfer?year=2026&month=3&format=xml', '無效的格式參數'],
    ['http://localhost/api/reports/bank-transfer?year=2026&month=3&bankCode=80A', '無效的銀行代碼參數'],
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
    expect(mockedPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });
});