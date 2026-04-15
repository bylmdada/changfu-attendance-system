jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('forgot password route', () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns 503 when forgot-password email reset is disabled', async () => {
    const request = new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'employee@example.com' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: 'Email 重設功能尚未啟用，請聯繫系統管理員協助重設密碼。',
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(request, '/api/auth/forgot-password');
  });

  it('returns 429 when rate limit blocks the request', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 } as never);

    const request = new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({
      error: '請稍後再試',
      retryAfter: 120,
    });
  });

  it('returns 500 when rate-limit checking throws unexpectedly', async () => {
    const failure = new Error('redis down');
    mockCheckRateLimit.mockRejectedValue(failure);

    const request = new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: '系統錯誤' });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Forgot password request failed:', failure);
  });
});