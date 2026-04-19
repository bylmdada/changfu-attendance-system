import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/system-settings/leave-rules-config/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    $transaction: jest.fn(),
    leaveRulesConfig: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('leave rules config route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.leaveRulesConfig.findFirst.mockResolvedValue(null);
    mockedPrisma.leaveRulesConfig.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedPrisma.leaveRulesConfig.create.mockResolvedValue({
      id: 5,
      parentalLeaveFlexible: true,
      parentalLeaveMaxDays: 30,
      parentalLeaveCombinedMax: 60,
      familyCareLeaveMaxDays: 7,
      familyCareHourlyEnabled: true,
      familyCareHourlyMaxHours: 56,
      familyCareNoDeductAttendance: true,
      sickLeaveAnnualMax: 30,
      sickLeaveNoDeductDays: 10,
      sickLeaveHalfPay: true,
      annualLeaveRollover: false,
      annualLeaveRolloverMax: 0,
      compLeaveRollover: false,
      compLeaveRolloverMax: 0,
      compLeaveExpiryMonths: 6,
      effectiveDate: new Date('2025-01-01'),
      isActive: true,
      description: '新假別規則',
      createdAt: new Date('2024-12-01T00:00:00.000Z'),
      updatedAt: new Date('2024-12-01T00:00:00.000Z'),
    } as never);
    mockedPrisma.$transaction.mockResolvedValue([
      { count: 1 },
      {
        id: 5,
        parentalLeaveFlexible: true,
        parentalLeaveMaxDays: 30,
        parentalLeaveCombinedMax: 60,
        familyCareLeaveMaxDays: 7,
        familyCareHourlyEnabled: true,
        familyCareHourlyMaxHours: 56,
        familyCareNoDeductAttendance: true,
        sickLeaveAnnualMax: 30,
        sickLeaveNoDeductDays: 10,
        sickLeaveHalfPay: true,
        annualLeaveRollover: false,
        annualLeaveRolloverMax: 0,
        compLeaveRollover: false,
        compLeaveRolloverMax: 0,
        compLeaveExpiryMonths: 6,
        effectiveDate: new Date('2025-01-01'),
        isActive: true,
        description: '新假別規則',
        createdAt: new Date('2024-12-01T00:00:00.000Z'),
        updatedAt: new Date('2024-12-01T00:00:00.000Z'),
      },
    ] as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
  });

  it('rejects non-admin GET requests', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 2,
      username: 'user',
      role: 'HR',
      employee: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config'));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: '需要管理員權限' });
    expect(mockedPrisma.leaveRulesConfig.findFirst).not.toHaveBeenCalled();
  });

  it('returns 401 for unauthenticated GET requests', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce(null as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config'));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: '未授權訪問' });
    expect(mockedPrisma.leaveRulesConfig.findFirst).not.toHaveBeenCalled();
  });

  it('allows admin GET requests', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.isDefault).toBe(true);
  });

  it('uses a transaction when replacing the active leave rules config', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        parentalLeaveFlexible: true,
        parentalLeaveMaxDays: 30,
        parentalLeaveCombinedMax: 60,
        familyCareLeaveMaxDays: 7,
        familyCareHourlyEnabled: true,
        familyCareHourlyMaxHours: 56,
        familyCareNoDeductAttendance: true,
        sickLeaveAnnualMax: 30,
        sickLeaveNoDeductDays: 10,
        sickLeaveHalfPay: true,
        annualLeaveRollover: false,
        annualLeaveRolloverMax: 0,
        compLeaveRollover: false,
        compLeaveRolloverMax: 0,
        compLeaveExpiryMonths: 6,
        effectiveDate: '2025-01-01',
        description: '新假別規則',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed JSON bodies before validating leave rules fields', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"effectiveDate":',
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects null bodies on POST before destructuring leave rules fields', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請提供有效的設定資料' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects impossible effective dates before replacing the active leave rules config', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        parentalLeaveFlexible: true,
        parentalLeaveMaxDays: 30,
        parentalLeaveCombinedMax: 60,
        familyCareLeaveMaxDays: 7,
        familyCareHourlyEnabled: true,
        familyCareHourlyMaxHours: 56,
        familyCareNoDeductAttendance: true,
        sickLeaveAnnualMax: 30,
        sickLeaveNoDeductDays: 10,
        sickLeaveHalfPay: true,
        annualLeaveRollover: false,
        annualLeaveRolloverMax: 0,
        compLeaveRollover: false,
        compLeaveRolloverMax: 0,
        compLeaveExpiryMonths: 6,
        effectiveDate: '2025-02-30',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '生效日期格式無效' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid numeric fields instead of silently falling back to defaults', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        parentalLeaveFlexible: true,
        parentalLeaveMaxDays: 30,
        parentalLeaveCombinedMax: 60,
        familyCareLeaveMaxDays: 7,
        familyCareHourlyEnabled: true,
        familyCareHourlyMaxHours: 56,
        familyCareNoDeductAttendance: true,
        sickLeaveAnnualMax: 'abc',
        sickLeaveNoDeductDays: 10,
        sickLeaveHalfPay: true,
        annualLeaveRollover: false,
        annualLeaveRolloverMax: 0,
        compLeaveRollover: false,
        compLeaveRolloverMax: 0,
        compLeaveExpiryMonths: 6,
        effectiveDate: '2025-01-01',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '病假年度上限必須為正整數' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid boolean fields instead of silently falling back to defaults', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        parentalLeaveFlexible: true,
        parentalLeaveMaxDays: 30,
        parentalLeaveCombinedMax: 60,
        familyCareLeaveMaxDays: 7,
        familyCareHourlyEnabled: 'true',
        familyCareHourlyMaxHours: 56,
        familyCareNoDeductAttendance: true,
        sickLeaveAnnualMax: 30,
        sickLeaveNoDeductDays: 10,
        sickLeaveHalfPay: true,
        annualLeaveRollover: false,
        annualLeaveRolloverMax: 0,
        compLeaveRollover: false,
        compLeaveRolloverMax: 0,
        compLeaveExpiryMonths: 6,
        effectiveDate: '2025-01-01',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '家庭照顧假事假補充設定格式無效' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects inconsistent parent and sick leave thresholds before replacing the active config', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/leave-rules-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        parentalLeaveFlexible: true,
        parentalLeaveMaxDays: 30,
        parentalLeaveCombinedMax: 20,
        familyCareLeaveMaxDays: 7,
        familyCareHourlyEnabled: true,
        familyCareHourlyMaxHours: 56,
        familyCareNoDeductAttendance: true,
        sickLeaveAnnualMax: 30,
        sickLeaveNoDeductDays: 10,
        sickLeaveHalfPay: true,
        annualLeaveRollover: false,
        annualLeaveRolloverMax: 0,
        compLeaveRollover: false,
        compLeaveRolloverMax: 0,
        compLeaveExpiryMonths: 6,
        effectiveDate: '2025-01-01',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '雙親合計上限不得低於個人上限' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
