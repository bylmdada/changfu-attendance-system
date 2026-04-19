jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findMany: jest.fn(),
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

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('schedule confirm route csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.$transaction.mockResolvedValue([] as never);
  });

  it('rejects POST when csrf validation fails', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false } as never);

    const request = new NextRequest('http://localhost/api/system-settings/schedule-confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        enabled: true,
        blockClock: true,
        enableReminder: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects POST when request body is null instead of crashing with 500', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/schedule-confirm', {
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
    expect(payload.error).toBe('請提供有效的設定資料');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects POST when request body is malformed JSON instead of crashing with 500', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/schedule-confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"enabled":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects POST when enabled is not a boolean', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/schedule-confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        enabled: 'yes',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('啟用狀態必須是布林值');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects POST when rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false } as never);

    const request = new NextRequest('http://localhost/api/system-settings/schedule-confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        enabled: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({ error: 'Too many requests' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
