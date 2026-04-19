import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/system-settings/labor-law-config/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    $transaction: jest.fn(),
    laborLawConfig: {
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

const createdLaborLawConfig = {
  id: 3,
  basicWage: 30000,
  laborInsuranceRate: 0.12,
  laborInsuranceMax: 46000,
  laborEmployeeRate: 0.2,
  effectiveDate: new Date('2025-01-01'),
  isActive: true,
  description: '新法規',
  createdAt: new Date('2024-12-01T00:00:00.000Z'),
  updatedAt: new Date('2024-12-01T00:00:00.000Z'),
};

describe('labor law config route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.laborLawConfig.findFirst.mockResolvedValue(null);
    mockedPrisma.laborLawConfig.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedPrisma.laborLawConfig.create.mockResolvedValue(createdLaborLawConfig as never);
    mockedPrisma.$transaction.mockResolvedValue([
      { count: 1 },
      createdLaborLawConfig,
    ] as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
  });

  it('rejects non-admin GET requests', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 2,
      username: 'employee',
      role: 'EMPLOYEE',
      employee: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/system-settings/labor-law-config'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.isDefault).toBe(true);
  });

  it('allows admin GET requests', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/system-settings/labor-law-config'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.isDefault).toBe(true);
  });

  it('uses a transaction when replacing the active config', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/labor-law-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        basicWage: 30000,
        laborInsuranceRate: 0.12,
        laborInsuranceMax: 46000,
        laborEmployeeRate: 0.2,
        effectiveDate: '2025-01-01',
        description: '新法規',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects impossible effective dates before replacing the active config', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/labor-law-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        basicWage: 30000,
        laborInsuranceRate: 0.12,
        laborInsuranceMax: 46000,
        laborEmployeeRate: 0.2,
        effectiveDate: '2025-02-30',
        description: '錯誤日期',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '生效日期格式無效' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before replacing the active config', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/labor-law-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"basicWage":',
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid numeric fields instead of silently falling back to defaults', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/labor-law-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        basicWage: 'abc',
        laborInsuranceRate: 0.12,
        laborInsuranceMax: 46000,
        laborEmployeeRate: 0.2,
        effectiveDate: '2025-01-01',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '基本工資必須為正整數' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects out-of-range labor rates before replacing the active config', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/labor-law-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        basicWage: 30000,
        laborInsuranceRate: 1.2,
        laborInsuranceMax: 46000,
        laborEmployeeRate: 0.2,
        effectiveDate: '2025-01-01',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '勞保費率必須為 0 到 1 之間的數值' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects labor insurance max values below the configured basic wage', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/system-settings/labor-law-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        basicWage: 30000,
        laborInsuranceRate: 0.12,
        laborInsuranceMax: 29000,
        laborEmployeeRate: 0.2,
        effectiveDate: '2025-01-01',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '投保薪資上限不得低於基本工資' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
