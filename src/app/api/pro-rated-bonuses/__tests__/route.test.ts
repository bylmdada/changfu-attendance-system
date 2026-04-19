jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    employeeAnnualBonus: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    bonusRecord: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/pro-rated-bonus-calculator', () => ({
  calculateYearEndBonus: jest.fn(),
  calculateFestivalBonus: jest.fn(),
  batchCalculateYearEndBonus: jest.fn(),
  batchCalculateFestivalBonus: jest.fn(),
  generateProRatedBonusReport: jest.fn(),
}));

jest.mock('@/lib/tax-calculator', () => ({
  calculateBonusSupplementaryPremium: jest.fn(),
  getInsuredAmount: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import {
  calculateFestivalBonus,
  calculateYearEndBonus,
  batchCalculateFestivalBonus,
  batchCalculateYearEndBonus,
  generateProRatedBonusReport,
} from '@/lib/pro-rated-bonus-calculator';
import {
  calculateBonusSupplementaryPremium,
  getInsuredAmount,
} from '@/lib/tax-calculator';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCalculateFestivalBonus = calculateFestivalBonus as jest.MockedFunction<typeof calculateFestivalBonus>;
const mockCalculateYearEndBonus = calculateYearEndBonus as jest.MockedFunction<typeof calculateYearEndBonus>;
const mockBatchCalculateFestivalBonus = batchCalculateFestivalBonus as jest.MockedFunction<typeof batchCalculateFestivalBonus>;
const mockBatchCalculateYearEndBonus = batchCalculateYearEndBonus as jest.MockedFunction<typeof batchCalculateYearEndBonus>;
const mockGenerateProRatedBonusReport = generateProRatedBonusReport as jest.MockedFunction<typeof generateProRatedBonusReport>;
const mockCalculateBonusSupplementaryPremium = calculateBonusSupplementaryPremium as jest.MockedFunction<typeof calculateBonusSupplementaryPremium>;
const mockGetInsuredAmount = getInsuredAmount as jest.MockedFunction<typeof getInsuredAmount>;

describe('pro-rated bonuses route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({
      userId: 10,
      employeeId: 88,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.employee.findMany.mockResolvedValue([] as never);
    mockPrisma.employee.findUnique.mockResolvedValue(null as never);
    mockPrisma.employeeAnnualBonus.upsert.mockResolvedValue({
      id: 301,
      employeeId: 12,
      year: 2026,
      totalBonusAmount: 0,
      supplementaryPremium: 0,
    } as never);
    mockPrisma.employeeAnnualBonus.update.mockResolvedValue({} as never);
    mockPrisma.bonusRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.bonusRecord.create.mockResolvedValue({ id: 901 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => {
      return callback(mockPrisma as never) as never;
    });

    mockCalculateYearEndBonus.mockResolvedValue({
      bonusType: 'YEAR_END',
      bonusTypeName: '年終獎金',
      proRatedAmount: 32000,
    } as never);
    mockCalculateFestivalBonus.mockResolvedValue({
      bonusType: 'FESTIVAL',
      bonusTypeName: '春節獎金',
      proRatedAmount: 5000,
    } as never);
    mockBatchCalculateFestivalBonus.mockResolvedValue([] as never);
    mockBatchCalculateYearEndBonus.mockResolvedValue([] as never);
    mockGenerateProRatedBonusReport.mockResolvedValue({ summary: [] } as never);
    mockCalculateBonusSupplementaryPremium.mockReturnValue({
      exemptThreshold: 0,
      currentYearBonusTotal: 0,
      calculationBase: 32000,
      premiumAmount: 672,
      premiumRate: 0.0211,
    } as never);
    mockGetInsuredAmount.mockReturnValue(45800);
  });

  it('rejects unauthenticated GET requests before querying bonus data', async () => {
    mockGetUserFromRequest.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses?action=calculate-batch&year=2026&bonusType=YEAR_END');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects calculate-individual requests with mixed employeeId query values', async () => {
    const request = new NextRequest('http://localhost/api/pro-rated-bonuses?action=calculate-individual&employeeId=12abc&year=2026&bonusType=YEAR_END');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, error: 'employeeId 參數格式無效' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockCalculateYearEndBonus).not.toHaveBeenCalled();
  });

  it('rejects calculate-batch requests with mixed year query values', async () => {
    const request = new NextRequest('http://localhost/api/pro-rated-bonuses?action=calculate-batch&year=2026abc&bonusType=YEAR_END');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, error: 'year 參數格式無效' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockBatchCalculateYearEndBonus).not.toHaveBeenCalled();
  });

  it('rejects POST when csrf validation fails before creating bonus records', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'batch-calculate-and-create',
        employeeIds: [12],
        bonusType: 'YEAR_END',
        year: 2026,
        autoCreateRecords: true,
        createdBy: 999,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.bonusRecord.create).not.toHaveBeenCalled();
  });

  it('uses authenticated employeeId instead of caller supplied createdBy', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 12,
        name: '測試員工',
        employeeId: 'E012',
        hireDate: new Date('2024-01-15'),
        baseSalary: 48000,
        isActive: true,
        dependents: 0,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'valid-token',
      },
      body: JSON.stringify({
        action: 'batch-calculate-and-create',
        employeeIds: [12],
        bonusType: 'YEAR_END',
        year: 2026,
        autoCreateRecords: true,
        createdBy: 999,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.bonusRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdBy: 88,
        }),
      })
    );
  });

  it('returns 400 for malformed JSON before querying bonus data', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, error: '無效的 JSON 格式' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.employeeAnnualBonus.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.bonusRecord.create).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects batch create requests with mixed year body values', async () => {
    const request = new NextRequest('http://localhost/api/pro-rated-bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'batch-calculate-and-create',
        employeeIds: [12],
        bonusType: 'YEAR_END',
        year: '2026abc',
        autoCreateRecords: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, error: 'year 欄位格式無效' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.employeeAnnualBonus.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.bonusRecord.create).not.toHaveBeenCalled();
  });

  it('returns festival batch calculation results with snake_case keys expected by the page', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 12,
        name: '測試員工',
        employeeId: 'E012',
        hireDate: new Date('2024-01-15'),
        baseSalary: 48000,
        isActive: true,
        department: 'HR',
        position: '專員',
      },
    ] as never);
    mockBatchCalculateFestivalBonus
      .mockResolvedValueOnce([{ id: 'spring' }] as never)
      .mockResolvedValueOnce([{ id: 'dragon' }] as never)
      .mockResolvedValueOnce([{ id: 'mid' }] as never);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses?action=calculate-batch&year=2026&bonusType=FESTIVAL');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.calculations.festivalBonus).toEqual({
      spring_festival: [{ id: 'spring' }],
      dragon_boat: [{ id: 'dragon' }],
      mid_autumn: [{ id: 'mid' }],
    });
  });

  it('creates festival bonus records using the caller selected festival type', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 12,
        name: '測試員工',
        employeeId: 'E012',
        hireDate: new Date('2024-01-15'),
        baseSalary: 48000,
        isActive: true,
        dependents: 0,
      },
    ] as never);
    mockCalculateFestivalBonus.mockResolvedValue({
      bonusType: 'FESTIVAL',
      bonusTypeName: '端午節獎金',
      proRatedAmount: 5000,
    } as never);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'valid-token',
      },
      body: JSON.stringify({
        action: 'batch-calculate-and-create',
        employeeIds: [12],
        bonusType: 'FESTIVAL',
        festivalType: 'dragon_boat',
        year: 2026,
        autoCreateRecords: true,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockCalculateFestivalBonus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
      expect.objectContaining({ name: 'dragon_boat', month: 6, description: '端午節獎金' }),
      2026,
      expect.any(Object)
    );
    expect(mockPrisma.bonusRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bonusTypeName: '端午節獎金',
          payrollMonth: 6,
        }),
      })
    );
  });

  it('returns 400 when every auto-created bonus record fails to persist', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 12,
        name: '測試員工',
        employeeId: 'E012',
        hireDate: new Date('2024-01-15'),
        baseSalary: 48000,
        isActive: true,
        dependents: 0,
      },
    ] as never);
    mockPrisma.bonusRecord.create.mockRejectedValueOnce(new Error('insert failed') as never);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'valid-token',
      },
      body: JSON.stringify({
        action: 'batch-calculate-and-create',
        employeeIds: [12],
        bonusType: 'YEAR_END',
        year: 2026,
        autoCreateRecords: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      error: '所有獎金記錄建立失敗',
      failedEmployeeIds: [12],
      errors: ['員工 測試員工 的獎金記錄建立失敗'],
    });
  });

  it('fails closed when every requested employee id is stale or inactive before any record creation', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'valid-token',
      },
      body: JSON.stringify({
        action: 'batch-calculate-and-create',
        employeeIds: [12, 13],
        bonusType: 'YEAR_END',
        year: 2026,
        autoCreateRecords: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      error: '所有獎金記錄建立失敗',
      failedEmployeeIds: [12, 13],
      errors: ['員工 ID 12 不存在或已停用', '員工 ID 13 不存在或已停用'],
    });
    expect(mockPrisma.employeeAnnualBonus.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.bonusRecord.create).not.toHaveBeenCalled();
  });

  it('keeps stale requested employee ids in failedEmployeeIds when other records are created', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 12,
        name: '測試員工',
        employeeId: 'E012',
        hireDate: new Date('2024-01-15'),
        baseSalary: 48000,
        isActive: true,
        dependents: 0,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/pro-rated-bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'valid-token',
      },
      body: JSON.stringify({
        action: 'batch-calculate-and-create',
        employeeIds: [12, 13],
        bonusType: 'YEAR_END',
        year: 2026,
        autoCreateRecords: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.createdRecordsCount).toBe(1);
    expect(payload.data.failedRecordsCount).toBe(1);
    expect(payload.data.failedEmployeeIds).toEqual([13]);
    expect(payload.data.errors).toEqual(['員工 ID 13 不存在或已停用']);
  });
});
