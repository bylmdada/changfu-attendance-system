import { NextRequest } from 'next/server';
import { GET } from '@/app/api/overtime-status/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { calculateOvertimeRequestsEligibility } from '@/lib/overtime-eligibility';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/overtime-eligibility', () => ({
  calculateOvertimeRequestsEligibility: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeClockRecord: {
      findMany: jest.fn(),
    },
    overtimeRequest: {
      findMany: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
  },
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedCalculateEligibility = calculateOvertimeRequestsEligibility as jest.MockedFunction<
  typeof calculateOvertimeRequestsEligibility
>;
const mockPrisma = jest.requireMock('@/lib/database').prisma as {
  overtimeClockRecord: { findMany: jest.Mock };
  overtimeRequest: { findMany: jest.Mock };
  systemSettings: { findUnique: jest.Mock };
};

describe('overtime status auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedCalculateEligibility.mockResolvedValue({
      byRequestId: new Map(),
      byEmployeeDate: new Map(),
      totalEffectiveHours: 0,
    } as never);
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockedGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/overtime-status');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('未授權訪問');
  });

  it('shows effective approved hours, requested pending hours, and minute-precise active duration', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T10:31:00.000Z'));
    mockedGetUserFromRequest.mockResolvedValue({ employeeId: 99, role: 'EMPLOYEE' } as never);
    mockPrisma.overtimeClockRecord.findMany.mockResolvedValue([{
      id: 1,
      clockType: 'START',
      clockTime: new Date('2026-07-17T10:00:00.000Z'),
      createdAt: new Date('2026-07-17T10:00:00.000Z'),
    }]);
    const approved = [{
      id: 10,
      employeeId: 99,
      overtimeDate: new Date('2026-07-01T00:00:00.000Z'),
      totalHours: 2,
    }];
    mockPrisma.overtimeRequest.findMany
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce([{ id: 11, totalHours: 2 }]);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      value: JSON.stringify({ monthlyLimit: 46, warningThreshold: 36, enabled: true }),
    });
    mockedCalculateEligibility.mockResolvedValue({
      byRequestId: new Map(),
      byEmployeeDate: new Map(),
      totalEffectiveHours: 0.19,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/overtime-status'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockedCalculateEligibility).toHaveBeenCalledWith(approved);
    expect(data.currentSession.estimatedHours).toBe(0.52);
    expect(data.monthlyStats).toMatchObject({
      approvedHours: 0.19,
      pendingHours: 2,
      totalHours: 2.19,
      remainingHours: 45.81,
    });
    jest.useRealTimers();
  });
});
