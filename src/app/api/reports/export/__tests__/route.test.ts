import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('payroll export HTML escaping', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);

    mockedPrisma.payrollRecord.findMany.mockResolvedValue([
      {
        id: 1,
        payYear: 2026,
        payMonth: 3,
        regularHours: 160,
        overtimeHours: 8,
        basePay: 40000,
        overtimePay: 2144,
        grossPay: 42144,
        laborInsurance: 900,
        healthInsurance: 650,
        supplementaryInsurance: 100,
        incomeTax: 1200,
        totalDeductions: 2850,
        netPay: 39294,
        createdAt: new Date('2026-03-31T00:00:00Z'),
        employee: {
          employeeId: 'EMP<123>',
          name: '<img src=x onerror=alert(1)>',
          department: '<svg/onload=alert(2)>',
          position: 'Dev & Ops',
          hourlyRate: 200,
        },
      },
    ] as never);
  });

  it('escapes query params and employee fields before embedding HTML', async () => {
    const request = new NextRequest('http://localhost/api/reports/export?year=2026&month=3&department=%3Cscript%3Ealert(3)%3C%2Fscript%3E');

    const response = await GET(request);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<svg/onload=alert(2)>');
    expect(html).not.toContain('<script>alert(3)</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;svg/onload=alert(2)&gt;');
    expect(html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
    expect(html).toContain('Dev &amp; Ops');
    expect(html).toContain('EMP&lt;123&gt;');
  });

  it.each([
    ['http://localhost/api/reports/export?year=abc&month=3', '無效的年份參數'],
    ['http://localhost/api/reports/export?year=2026&month=13', '無效的月份參數'],
  ])('returns 400 for invalid query params: %s', async (url, expectedError) => {
    const request = new NextRequest(url);

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: expectedError });
    expect(mockedPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });
});