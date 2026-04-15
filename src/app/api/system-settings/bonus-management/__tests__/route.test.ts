import { NextRequest } from 'next/server';
import { DELETE, GET, POST } from '@/app/api/system-settings/bonus-management/route';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    bonusConfiguration: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    bonusRecord: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('bonus management route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedPrisma.bonusConfiguration.findMany.mockResolvedValue([
      {
        id: 1,
        bonusType: 'YEAR_END',
        bonusTypeName: '年終獎金',
        description: '年度固定獎金',
        isActive: true,
        defaultAmount: 10000,
        calculationFormula: 'base_salary * 1',
        eligibilityRules: JSON.stringify({ minimumServiceMonths: 3 }),
        paymentSchedule: JSON.stringify({ paymentMonth: 12, paymentDay: 25 }),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    mockedPrisma.bonusConfiguration.findFirst.mockResolvedValue(null);
    mockedPrisma.bonusConfiguration.findUnique.mockResolvedValue({
      id: 1,
      bonusType: 'YEAR_END',
      bonusTypeName: '年終獎金',
      description: '年度固定獎金',
      isActive: true,
      defaultAmount: 10000,
      calculationFormula: 'base_salary * 1',
      eligibilityRules: JSON.stringify({ minimumServiceMonths: 3 }),
      paymentSchedule: JSON.stringify({ paymentMonth: 12, paymentDay: 25 }),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    mockedPrisma.bonusConfiguration.create.mockResolvedValue({
      id: 2,
      bonusType: 'MID_YEAR',
      bonusTypeName: '期中獎金',
      description: '半年度獎金',
      isActive: true,
      defaultAmount: 8000,
      calculationFormula: 'base_salary * 0.5',
      eligibilityRules: JSON.stringify({ minimumServiceMonths: 6 }),
      paymentSchedule: JSON.stringify({ paymentMonth: 6, paymentDay: 30 }),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    mockedPrisma.bonusConfiguration.delete.mockResolvedValue({ id: 1 } as never);
    mockedPrisma.bonusRecord.findFirst.mockResolvedValue(null);

    mockedRateLimit.mockResolvedValue({ allowed: true, remainingRequests: 10, resetTime: Date.now() + 60_000 });
    mockedValidateCSRF.mockResolvedValue({ valid: true });
    mockedGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.bonusTypes).toHaveLength(1);
    expect(data.bonusTypes[0]).toMatchObject({
      id: 1,
      bonusType: 'YEAR_END',
      bonusTypeName: '年終獎金',
    });
  });

  it('falls back to empty objects when legacy JSON fields are malformed', async () => {
    mockedPrisma.bonusConfiguration.findMany.mockResolvedValue([
      {
        id: 1,
        bonusType: 'YEAR_END',
        bonusTypeName: '年終獎金',
        description: '年度固定獎金',
        isActive: true,
        defaultAmount: 10000,
        calculationFormula: 'base_salary * 1',
        eligibilityRules: '{broken-json',
        paymentSchedule: '{broken-json',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.bonusTypes[0].eligibilityRules).toEqual({});
    expect(data.bonusTypes[0].paymentSchedule).toEqual({});
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        bonusType: 'MID_YEAR',
        bonusTypeName: '期中獎金',
        description: '半年度獎金',
        isActive: true,
        defaultAmount: 8000,
        calculationFormula: 'base_salary * 0.5',
        eligibilityRules: { minimumServiceMonths: 6 },
        paymentSchedule: { paymentMonth: 6, paymentDay: 30 },
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.bonusType).toMatchObject({
      id: 2,
      bonusType: 'MID_YEAR',
      bonusTypeName: '期中獎金',
    });
  });

  it('accepts shared token cookie extraction on DELETE requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management?id=1', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: '獎金類型已刪除',
    });
  });

  it('rejects malformed JSON bodies before validating bonus fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"bonusType":',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrisma.bonusConfiguration.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.create).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.update).not.toHaveBeenCalled();
  });

  it('rejects null bodies on POST before destructuring bonus fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請提供有效的設定資料' });
    expect(mockedPrisma.bonusConfiguration.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.create).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.update).not.toHaveBeenCalled();
  });

  it('rejects non-boolean active flags before storing bonus types', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        bonusType: 'MID_YEAR',
        bonusTypeName: '期中獎金',
        isActive: 'false',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '啟用狀態必須為布林值' });
    expect(mockedPrisma.bonusConfiguration.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.create).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.update).not.toHaveBeenCalled();
  });

  it('rejects malformed eligibilityRules payloads before storing bonus types', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        bonusType: 'MID_YEAR',
        bonusTypeName: '期中獎金',
        isActive: true,
        eligibilityRules: [],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '資格規則格式無效' });
    expect(mockedPrisma.bonusConfiguration.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.create).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.update).not.toHaveBeenCalled();
  });

  it('rejects malformed delete ids instead of coercing them with parseInt', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/bonus-management?id=12abc', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的獎金類型ID' });
    expect(mockedPrisma.bonusConfiguration.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.bonusConfiguration.delete).not.toHaveBeenCalled();
  });
});