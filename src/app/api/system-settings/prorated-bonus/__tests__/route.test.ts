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

describe('prorated bonus settings route', () => {
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
      key: 'prorated_bonus_settings',
      value: JSON.stringify({ isEnabled: true }),
    } as never);
  });

  it('returns default settings when no config exists', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/prorated-bonus', {
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
      calculationMethod: 'MONTHLY',
      cutoffDay: 15,
      prorateForNewHires: true,
      prorateForTerminated: true,
    });
  });

  it('saves settings through POST', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/prorated-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        isEnabled: true,
        calculationMethod: 'DAILY',
        cutoffDay: 20,
        prorateForNewHires: true,
        prorateForTerminated: false,
        minimumServiceDays: 60,
        yearEndBonusProration: true,
        festivalBonusProration: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings).toMatchObject({
      calculationMethod: 'DAILY',
      cutoffDay: 20,
      prorateForTerminated: false,
      minimumServiceDays: 60,
    });
  });

  it('falls back to defaults when stored prorated bonus JSON is malformed', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'prorated_bonus_settings',
      value: '{bad-json',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/prorated-bonus', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      calculationMethod: 'MONTHLY',
      cutoffDay: 15,
      minimumServiceDays: 90,
    });
  });

  it('preserves existing prorated bonus fields on partial POST updates', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'prorated_bonus_settings',
      value: JSON.stringify({
        isEnabled: false,
        calculationMethod: 'DAILY',
        cutoffDay: 20,
        prorateForNewHires: false,
        prorateForTerminated: true,
        minimumServiceDays: 45,
        yearEndBonusProration: false,
        festivalBonusProration: true,
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/prorated-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        minimumServiceDays: 60,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toEqual({
      isEnabled: false,
      calculationMethod: 'DAILY',
      cutoffDay: 20,
      prorateForNewHires: false,
      prorateForTerminated: true,
      minimumServiceDays: 60,
      yearEndBonusProration: false,
      festivalBonusProration: true,
    });
  });

  it('rejects null bodies before merging prorated bonus settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/prorated-bonus', {
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

  it('rejects malformed JSON before reading existing prorated bonus settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/prorated-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{bad-json',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid boolean fields before reading existing settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/prorated-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        isEnabled: 'true',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '啟用狀態必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});