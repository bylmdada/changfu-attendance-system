jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('payroll statistics route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 1 } as never);
    mockGetUserFromToken.mockResolvedValue({ role: 'HR', employeeId: 1 } as never);

    mockPrisma.payrollRecord.aggregate.mockResolvedValue({
      _count: { id: 0 },
      _sum: {
        regularHours: 0,
        overtimeHours: 0,
        basePay: 0,
        overtimePay: 0,
        grossPay: 0,
        netPay: 0
      },
      _avg: {
        regularHours: 0,
        overtimeHours: 0,
        basePay: 0,
        overtimePay: 0,
        grossPay: 0,
        netPay: 0
      }
    } as never);
    mockPrisma.payrollRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.payrollRecord.count.mockResolvedValue(0 as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost/api/payroll/statistics?year=2026', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.statistics.overall.totalRecords).toBe(0);
    expect(mockGetUserFromRequest).toHaveBeenCalled();
  });

  it('applies the department filter to aggregate and list queries', async () => {
    const request = new NextRequest('http://localhost/api/payroll/statistics?year=2026&department=製造部', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.payrollRecord.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          payYear: 2026,
          employee: {
            is: {
              department: '製造部'
            }
          }
        })
      })
    );
    expect(mockPrisma.payrollRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payYear: 2026,
          employee: {
            is: {
              department: '製造部'
            }
          }
        })
      })
    );
  });

  it('rejects malformed year and month query params before querying prisma', async () => {
    const invalidYearResponse = await GET(new NextRequest('http://localhost/api/payroll/statistics?year=20xx'));
    const invalidYearPayload = await invalidYearResponse.json();

    expect(invalidYearResponse.status).toBe(400);
    expect(invalidYearPayload.error).toBe('year 格式錯誤');

    const invalidMonthResponse = await GET(new NextRequest('http://localhost/api/payroll/statistics?year=2026&month=13'));
    const invalidMonthPayload = await invalidMonthResponse.json();

    expect(invalidMonthResponse.status).toBe(400);
    expect(invalidMonthPayload.error).toBe('month 格式錯誤');
    expect(mockPrisma.payrollRecord.aggregate).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.count).not.toHaveBeenCalled();
  });

  it('counts unique employees per department and exposes actual overtime pay totals', async () => {
    mockPrisma.payrollRecord.aggregate.mockResolvedValue({
      _count: { id: 3 },
      _sum: {
        regularHours: 480,
        overtimeHours: 24,
        basePay: 90000,
        overtimePay: 6000,
        grossPay: 96000,
        netPay: 90000
      },
      _avg: {
        regularHours: 160,
        overtimeHours: 8,
        basePay: 30000,
        overtimePay: 2000,
        grossPay: 32000,
        netPay: 30000
      }
    } as never);
    mockPrisma.payrollRecord.findMany.mockResolvedValue([
      {
        employeeId: 11,
        grossPay: 32000,
        netPay: 30000,
        regularHours: 160,
        overtimeHours: 8,
        employee: { department: '製造部' }
      },
      {
        employeeId: 11,
        grossPay: 33000,
        netPay: 31000,
        regularHours: 160,
        overtimeHours: 8,
        employee: { department: '製造部' }
      },
      {
        employeeId: 12,
        grossPay: 31000,
        netPay: 29000,
        regularHours: 160,
        overtimeHours: 8,
        employee: { department: '製造部' }
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/payroll/statistics?year=2026'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.statistics.overall.totalOvertimePay).toBe(6000);
    expect(payload.statistics.departmentStats).toEqual([
      expect.objectContaining({
        department: '製造部',
        employeeCount: 2,
        avgGrossPay: 32000,
        avgNetPay: 30000,
      })
    ]);
  });

  it('limits monthly trend aggregation to the selected month', async () => {
    const response = await GET(new NextRequest('http://localhost/api/payroll/statistics?year=2026&month=4'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.statistics.monthlyTrends).toHaveLength(1);
    expect(payload.statistics.monthlyTrends[0].month).toBe(4);
    expect(mockPrisma.payrollRecord.aggregate).toHaveBeenCalledTimes(2);
  });
});
