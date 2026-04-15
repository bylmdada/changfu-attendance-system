jest.mock('@/lib/database', () => ({
  prisma: {
    bonusRecord: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
    employeeAnnualBonus: {
      upsert: jest.fn(),
      update: jest.fn(),
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
  calculateBonusSupplementaryPremium,
  getInsuredAmount,
} from '@/lib/tax-calculator';
import { DELETE, GET, POST, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCalculateBonusSupplementaryPremium =
  calculateBonusSupplementaryPremium as jest.MockedFunction<typeof calculateBonusSupplementaryPremium>;
const mockGetInsuredAmount = getInsuredAmount as jest.MockedFunction<typeof getInsuredAmount>;

describe('bonuses route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetTime: Date.now() + 60_000,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'hr-admin',
      role: 'HR',
      employeeId: 88,
    } as never);

    mockPrisma.bonusRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 12,
      name: '測試員工',
      baseSalary: 48000,
      dependents: 0,
    } as never);
    mockPrisma.employeeAnnualBonus.upsert.mockResolvedValue({
      id: 501,
      employeeId: 12,
      year: 2026,
      totalBonusAmount: 0,
      supplementaryPremium: 0,
    } as never);
    mockPrisma.employeeAnnualBonus.update.mockResolvedValue({ id: 501 } as never);
    mockPrisma.bonusRecord.create.mockResolvedValue({ id: 9001 } as never);
    mockPrisma.bonusRecord.findUnique.mockResolvedValue({
      id: 15,
      employeeId: 12,
      annualBonusId: 501,
      amount: 12000,
      cumulativeBonusBefore: 0,
      cumulativeBonusAfter: 12000,
      supplementaryPremium: 253,
      insuredAmount: 45800,
      annualBonus: { id: 501 },
      employee: { baseSalary: 48000 },
    } as never);
    mockPrisma.bonusRecord.update.mockResolvedValue({ id: 15 } as never);
    mockPrisma.bonusRecord.delete.mockResolvedValue({ id: 15 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => {
      return callback(mockPrisma as never) as never;
    });
    mockCalculateBonusSupplementaryPremium.mockReturnValue({
      exemptThreshold: 0,
      currentYearBonusTotal: 0,
      calculationBase: 15000,
      premiumAmount: 317,
      premiumRate: 0.0211,
    } as never);
    mockGetInsuredAmount.mockReturnValue(45800);
  });

  it('allows GET for admin and HR users resolved via shared request auth', async () => {
    const request = new NextRequest('http://localhost/api/bonuses', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockGetUserFromRequest).toHaveBeenCalledWith(request);
  });

  it('blocks GET for non-admin roles before querying records', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 2,
      username: 'employee',
      role: 'EMPLOYEE',
      employeeId: 77,
    } as never);

    const request = new NextRequest('http://localhost/api/bonuses');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('無權限執行此操作');
    expect(mockPrisma.bonusRecord.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed GET employeeId filters instead of truncating them with parseInt', async () => {
    const request = new NextRequest('http://localhost/api/bonuses?employeeId=12abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeId格式無效');
    expect(mockPrisma.bonusRecord.findMany).not.toHaveBeenCalled();
  });

  it('requires csrf validation on POST requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false } as never);

    const request = new NextRequest('http://localhost/api/bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        employeeId: 12,
        bonusType: 'YEAR_END',
        amount: 5000,
        payrollYear: 2026,
        payrollMonth: 1,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF驗證失敗');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses authenticated employeeId instead of caller supplied createdBy on POST', async () => {
    const request = new NextRequest('http://localhost/api/bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        employeeId: 12,
        bonusType: 'YEAR_END',
        bonusTypeName: '年終獎金',
        amount: 15000,
        payrollYear: 2026,
        payrollMonth: 1,
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
    expect(mockPrisma.bonusRecord.create.mock.calls[0][0].data.createdBy).not.toBe(999);
  });

  it('returns 400 when POST body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"employeeId":12'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects non-object POST payloads before reading employee data', async () => {
    const request = new NextRequest('http://localhost/api/bonuses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(['not-an-object']),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated PUT requests before reading the bonus record', async () => {
    mockGetUserFromRequest.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/bonuses', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 15,
        amount: 15000,
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toContain('未授權');
    expect(mockPrisma.bonusRecord.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/bonuses', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"id":15'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.bonusRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects PUT when bonus record id is malformed instead of passing a dirty value downstream', async () => {
    const request = new NextRequest('http://localhost/api/bonuses', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: '15abc',
        amount: 15000,
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('獎金記錄ID格式無效');
    expect(mockPrisma.bonusRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects PUT when adjustmentReason has a non-string type', async () => {
    const request = new NextRequest('http://localhost/api/bonuses', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 15,
        amount: 15000,
        adjustmentReason: { reason: 'manual' },
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('adjustmentReason格式無效');
    expect(mockPrisma.bonusRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects DELETE when csrf validation fails before deleting the bonus record', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/bonuses?id=15', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.bonusRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.bonusRecord.delete).not.toHaveBeenCalled();
  });

  it('rejects malformed DELETE ids instead of truncating them with parseInt', async () => {
    const request = new NextRequest('http://localhost/api/bonuses?id=15abc', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('獎金記錄ID格式無效');
    expect(mockPrisma.bonusRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.bonusRecord.delete).not.toHaveBeenCalled();
  });
});
