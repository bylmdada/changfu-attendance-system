jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      findFirst: jest.fn(),
      findMany: jest.fn()
    },
    employee: {
      findUnique: jest.fn()
    },
    attendanceRecord: {
      findMany: jest.fn()
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

jest.mock('@/lib/tax-calculator', () => ({
  calculateAllDeductions: jest.fn()
}));

jest.mock('@/lib/perfect-attendance', () => ({
  calculatePerfectAttendanceBonus: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('payroll route body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
  });

  it('rejects null request bodies before destructuring payroll creation payload', async () => {
    const request = new NextRequest('http://localhost/api/payroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('員工ID、年份和月份為必填');
    expect(mockPrisma.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed payroll creation JSON before querying prisma', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/api/payroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it.each([
    ['employeeId=oops', '員工ID格式無效'],
    ['year=oops', '年份格式無效'],
    ['month=13', '月份格式無效'],
  ])('rejects invalid GET query params: %s', async (queryString, expectedError) => {
    const request = new NextRequest(`http://localhost/api/payroll?${queryString}`);

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe(expectedError);
    expect(mockPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });

  it('rate limits payroll listing before auth and prisma queries', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 20 } as never);

    const request = new NextRequest('http://localhost/api/payroll');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toBe('操作過於頻繁，請稍後再試');
    expect(mockGetUserFromRequest).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });
});
