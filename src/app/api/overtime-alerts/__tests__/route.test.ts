import { NextRequest } from 'next/server';
import { GET } from '@/app/api/overtime-alerts/route';
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
    systemSettings: {
      findUnique: jest.fn(),
    },
    overtimeRequest: {
      findMany: jest.fn(),
    },
  },
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedCalculateEligibility = calculateOvertimeRequestsEligibility as jest.MockedFunction<
  typeof calculateOvertimeRequestsEligibility
>;
const mockPrisma = jest.requireMock('@/lib/database').prisma as {
  systemSettings: { findUnique: jest.Mock };
  overtimeRequest: { findMany: jest.Mock };
};

describe('overtime alerts auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedCalculateEligibility.mockResolvedValue({
      byRequestId: new Map(),
      byEmployeeDate: new Map(),
      totalEffectiveHours: 0,
    } as never);
  });

  it('returns 403 for non-admin roles resolved via shared request auth', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 70,
      role: 'EMPLOYEE',
      username: 'employee',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-alerts');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('需要管理員權限');
  });

  it('classifies alerts using actual eligible hours instead of request duration', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      value: JSON.stringify({ monthlyLimit: 1, warningThreshold: 0.1, enabled: true }),
    });
    const approved = [{
      id: 10,
      employeeId: 70,
      overtimeDate: new Date('2026-07-01T00:00:00.000Z'),
      totalHours: 2,
      employee: {
        id: 70,
        employeeId: 'E070',
        name: '員工甲',
        department: '製造部',
        position: '技術員',
      },
    }];
    mockPrisma.overtimeRequest.findMany.mockResolvedValue(approved);
    mockedCalculateEligibility.mockResolvedValue({
      byRequestId: new Map(),
      byEmployeeDate: new Map([['70-2026-07-01', {
        employeeId: 70,
        workDate: '2026-07-01',
        requestIds: [10],
        effectiveHours: 0.19,
      }]]),
      totalEffectiveHours: 0.19,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/overtime-alerts?year=2026&month=7'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.alerts.exceeded).toHaveLength(0);
    expect(data.alerts.warning[0].totalHours).toBe(0.19);
  });
});
