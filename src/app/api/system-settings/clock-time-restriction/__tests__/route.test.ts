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
  getUserFromToken: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('clock time restriction route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
    mockGetUserFromToken.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'clock_time_restriction',
      value: JSON.stringify({
        enabled: true,
        restrictedStartHour: 23,
        restrictedEndHour: 5,
        message: '夜間時段暫停打卡服務',
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/clock-time-restriction', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.restrictedStartHour).toBe(23);
  });

  it('rejects non-admin GET requests before reading settings', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', userId: 2, employeeId: 2 } as never);

    const request = new NextRequest('http://localhost/api/system-settings/clock-time-restriction', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('需要管理員權限');
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'clock_time_restriction',
      value: JSON.stringify({ enabled: true }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/clock-time-restriction', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        enabled: true,
        restrictedStartHour: 22,
        restrictedEndHour: 6,
        message: '夜間時段暫停打卡服務',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('打卡時間限制設定已更新');
  });

  it('falls back to default settings when stored JSON is malformed on GET', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'clock_time_restriction',
      value: '{bad-json'
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/clock-time-restriction', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.restrictedStartHour).toBe(23);
    expect(payload.settings.restrictedEndHour).toBe(5);
  });

  it('rejects null bodies before validating clock time restriction settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-time-restriction', {
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
    const request = new NextRequest('http://localhost/api/system-settings/clock-time-restriction', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{invalid-json',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects dirty restrictedStartHour values before touching stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-time-restriction', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        restrictedStartHour: '23abc',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '開始時間需在 0-23 之間' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects dirty restrictedEndHour values before touching stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-time-restriction', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        restrictedEndHour: '5xyz',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '結束時間需在 0-23 之間' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});