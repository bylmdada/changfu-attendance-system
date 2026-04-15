jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('supplementary premium settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'supplementary_premium_settings',
      value: JSON.stringify({ isEnabled: true }),
    } as never);
  });

  it('returns default settings when no config exists', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/supplementary-premium', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings).toMatchObject({
      isEnabled: true,
      premiumRate: 2.11,
      exemptThresholdMultiplier: 4,
      calculationMethod: 'CUMULATIVE',
      resetPeriod: 'YEARLY',
    });
  });

  it('saves settings through POST', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/supplementary-premium', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        isEnabled: true,
        premiumRate: 2.11,
        exemptThresholdMultiplier: 4,
        minimumThreshold: 5000,
        maxMonthlyPremium: 1000000,
        exemptionThreshold: 20000,
        annualMaxDeduction: 1000000,
        salaryThreshold: 183200,
        dividendThreshold: 20000,
        salaryIncludeItems: {
          overtime: false,
          bonus: true,
          allowance: true,
          commission: true,
        },
        calculationMethod: 'CUMULATIVE',
        resetPeriod: 'YEARLY',
        applyToAllEmployees: true,
        description: '依據全民健康保險法規定之補充保費計算設定',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings).toMatchObject({
      isEnabled: true,
      premiumRate: 2.11,
    });
  });

  it('falls back to defaults when stored supplementary premium JSON is malformed', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'supplementary_premium_settings',
      value: '{bad-json',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/supplementary-premium', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      premiumRate: 2.11,
      exemptThresholdMultiplier: 4,
      calculationMethod: 'CUMULATIVE',
      salaryIncludeItems: {
        overtime: false,
        bonus: true,
      },
    });
  });

  it('preserves existing supplementary premium fields on partial POST updates', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'supplementary_premium_settings',
      value: JSON.stringify({
        isEnabled: false,
        premiumRate: 1.91,
        exemptThresholdMultiplier: 3,
        minimumThreshold: 4000,
        maxMonthlyPremium: 800000,
        exemptionThreshold: 15000,
        annualMaxDeduction: 900000,
        salaryThreshold: 150000,
        dividendThreshold: 15000,
        salaryIncludeItems: {
          overtime: true,
          bonus: false,
          allowance: true,
          commission: false,
        },
        calculationMethod: 'MONTHLY',
        resetPeriod: 'MONTHLY',
        applyToAllEmployees: false,
        description: 'custom premium config',
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/supplementary-premium', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        premiumRate: 2.21,
        salaryIncludeItems: {
          bonus: true,
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      isEnabled: false,
      premiumRate: 2.21,
      exemptThresholdMultiplier: 3,
      calculationMethod: 'MONTHLY',
      applyToAllEmployees: false,
      description: 'custom premium config',
      salaryIncludeItems: {
        overtime: true,
        bonus: true,
        allowance: true,
        commission: false,
      },
    });
  });

  it('rejects null bodies before merging supplementary premium settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/supplementary-premium', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before loading supplementary premium settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/supplementary-premium', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"premiumRate": 2.11',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});