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

describe('leave expiry route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'leave_expiry_settings',
      value: JSON.stringify({
        compLeaveExpiryMonths: 6,
        annualLeaveCanExtend: true,
        expiryMode: 'NOTIFY_ONLY',
        reminderDaysBefore: [30, 14, 7],
        enabled: true,
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.expiryMode).toBe('NOTIFY_ONLY');
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'leave_expiry_settings',
      value: JSON.stringify({ enabled: true }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        compLeaveExpiryMonths: 12,
        annualLeaveCanExtend: false,
        expiryMode: 'AUTO_EXTEND',
        reminderDaysBefore: [21, 7],
        enabled: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('假期到期設定已更新');
  });

  it('falls back to defaults when stored leave-expiry JSON is malformed', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'leave_expiry_settings',
      value: '{broken-json',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      compLeaveExpiryMonths: 6,
      annualLeaveCanExtend: true,
      expiryMode: 'NOTIFY_ONLY',
      reminderDaysBefore: [30, 14, 7],
      enabled: true,
    });
  });

  it('preserves existing values when POST omits leave-expiry fields', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'leave_expiry_settings',
      value: JSON.stringify({
        compLeaveExpiryMonths: 9,
        annualLeaveCanExtend: false,
        expiryMode: 'AUTO_SETTLE',
        reminderDaysBefore: [10, 5],
        enabled: false,
      }),
    } as never);
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'leave_expiry_settings',
      value: JSON.stringify({ enabled: true }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toEqual({
      compLeaveExpiryMonths: 9,
      annualLeaveCanExtend: false,
      expiryMode: 'AUTO_SETTLE',
      reminderDaysBefore: [10, 5],
      enabled: true,
    });
  });

  it('rejects null bodies before validating leave-expiry settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
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
    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"enabled":true,',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid compLeaveExpiryMonths before loading existing settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        compLeaveExpiryMonths: 0,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '補休有效期限需在 1-24 個月之間' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean annualLeaveCanExtend before loading existing settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        annualLeaveCanExtend: 'yes',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'annualLeaveCanExtend 必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean enabled before loading existing settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: 'true',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'enabled 必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid reminderDaysBefore arrays before loading existing settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/leave-expiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reminderDaysBefore: [30, '14'],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'reminderDaysBefore 必須為 0 到 365 的整數陣列' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});