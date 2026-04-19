jest.mock('@/lib/database', () => ({
  prisma: {
    bonusConfiguration: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('bonus config route regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.bonusConfiguration.findMany.mockResolvedValue([] as never);
    mockPrisma.bonusConfiguration.findUnique.mockResolvedValue(null as never);
    mockPrisma.bonusConfiguration.upsert.mockResolvedValue({
      bonusType: 'YEAR_END',
      bonusTypeName: '年終獎金',
      eligibilityRules: '{}',
      paymentSchedule: '{}',
      isActive: true,
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => {
      return callback(mockPrisma as never) as never;
    });
  });

  it('rejects GET requests from users without admin or HR roles', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 2,
      username: 'employee',
      role: 'EMPLOYEE',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/bonus-config');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('無權限');
    expect(mockPrisma.bonusConfiguration.findMany).not.toHaveBeenCalled();
  });

  it('requires csrf validation on POST requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false } as never);

    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        yearEndConfig: {
          bonusTypeName: '新年終獎金',
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF 驗證失敗');
    expect(mockPrisma.bonusConfiguration.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.bonusConfiguration.upsert).not.toHaveBeenCalled();
  });

  it('restricts POST requests to admin users only', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 3,
      username: 'hr-user',
      role: 'HR',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        yearEndConfig: {
          bonusTypeName: '新年終獎金',
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('無權限');
    expect(mockPrisma.bonusConfiguration.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.bonusConfiguration.upsert).not.toHaveBeenCalled();
  });

  it('falls back to empty objects when stored bonus config JSON is malformed', async () => {
    mockPrisma.bonusConfiguration.findMany.mockResolvedValue([
      {
        bonusType: 'YEAR_END',
        bonusTypeName: '年終獎金',
        eligibilityRules: '{bad-json',
        paymentSchedule: '{"month":1}',
        isActive: true,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/system-settings/bonus-config');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.configs).toEqual([
      expect.objectContaining({
        bonusType: 'YEAR_END',
        eligibilityRules: {},
        paymentSchedule: { month: 1 },
      }),
    ]);
  });

  it('preserves stored nested config fields on partial updates', async () => {
    mockPrisma.bonusConfiguration.findUnique.mockResolvedValue({
      bonusType: 'YEAR_END',
      bonusTypeName: '舊年終獎金',
      eligibilityRules: JSON.stringify({ minimumServiceMonths: 6, includeProbation: false }),
      paymentSchedule: JSON.stringify({ month: 1, splitPayment: true }),
      isActive: true,
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        yearEndConfig: {
          bonusTypeName: '新年終獎金',
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.bonusConfiguration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bonusType: 'YEAR_END' },
        update: expect.objectContaining({
          bonusTypeName: '新年終獎金',
          isActive: true,
          eligibilityRules: JSON.stringify({ minimumServiceMonths: 6, includeProbation: false }),
          paymentSchedule: JSON.stringify({ month: 1, splitPayment: true }),
        }),
        create: expect.objectContaining({
          bonusTypeName: '新年終獎金',
          isActive: true,
          eligibilityRules: JSON.stringify({ minimumServiceMonths: 6, includeProbation: false }),
          paymentSchedule: JSON.stringify({ month: 1, splitPayment: true }),
        }),
      })
    );
  });

  it('rejects null bodies on POST before destructuring bonus config payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.bonusConfiguration.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.bonusConfiguration.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before reading bonus config payload fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"yearEndConfig":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.bonusConfiguration.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.bonusConfiguration.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-object year-end config payloads before reading nested fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        yearEndConfig: [],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '年終獎金設定格式無效' });
    expect(mockPrisma.bonusConfiguration.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.bonusConfiguration.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed nested eligibility rules before upserting bonus config', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        festivalConfig: {
          bonusTypeName: '三節獎金',
          eligibilityRules: [],
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '三節獎金資格規則格式無效' });
    expect(mockPrisma.bonusConfiguration.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.bonusConfiguration.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean active flags before upserting bonus config', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        yearEndConfig: {
          isActive: 'false',
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '年終獎金啟用狀態必須為布林值' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.bonusConfiguration.upsert).not.toHaveBeenCalled();
  });

  it('persists disabled state from incoming config instead of forcing active', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/bonus-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        festivalConfig: {
          isActive: false,
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, message: '設定已儲存' });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.bonusConfiguration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bonusType: 'FESTIVAL' },
        update: expect.objectContaining({ isActive: false }),
        create: expect.objectContaining({ isActive: false }),
      })
    );
  });
});
