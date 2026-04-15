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

describe('overtime limit route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'overtime_limit_settings',
      value: JSON.stringify({
        monthlyLimit: 46,
        warningThreshold: 36,
        exceedMode: 'BLOCK',
        enabled: true,
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.monthlyLimit).toBe(46);
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'overtime_limit_settings',
      value: JSON.stringify({ enabled: true }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        monthlyLimit: 40,
        warningThreshold: 30,
        exceedMode: 'FORCE_REVIEW',
        enabled: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('加班上限設定已更新');
  });

  it('falls back to default settings when stored JSON is malformed on GET', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'overtime_limit_settings',
      value: '{bad-json'
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.monthlyLimit).toBe(46);
    expect(payload.settings.warningThreshold).toBe(36);
  });

  it('rejects warningThreshold above the effective limit when monthlyLimit is omitted', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        warningThreshold: 80,
        exceedMode: 'FORCE_REVIEW',
        enabled: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('警告門檻需小於月加班上限');
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects null bodies before validating overtime limit settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
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

  it('returns 400 when POST body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"monthlyLimit":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects dirty monthlyLimit values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        monthlyLimit: '46abc',
        warningThreshold: 30,
        exceedMode: 'BLOCK',
        enabled: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '月加班上限需在 0-100 小時之間' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects dirty warningThreshold values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        monthlyLimit: 46,
        warningThreshold: '36xyz',
        exceedMode: 'BLOCK',
        enabled: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '警告門檻需小於月加班上限' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean enabled values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        monthlyLimit: 46,
        warningThreshold: 30,
        exceedMode: 'BLOCK',
        enabled: 'true',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '啟用狀態必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid exceedMode values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/overtime-limit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        monthlyLimit: 46,
        warningThreshold: 30,
        exceedMode: ['BLOCK'],
        enabled: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的超限處理模式' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});