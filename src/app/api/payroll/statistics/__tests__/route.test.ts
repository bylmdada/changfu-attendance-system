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
});