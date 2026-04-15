jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { POST } from '../route';

const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('/api/auth/logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remainingRequests: 10, resetTime: Date.now() });
    mockValidateCSRF.mockResolvedValue({ valid: true });
  });

  it('rejects logout when csrf validation fails', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false });

    const request = new NextRequest('http://localhost/api/auth/logout', {
      method: 'POST',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: 'CSRF驗證失敗' });
  });

  it('clears current and legacy auth cookies after successful logout', async () => {
    const request = new NextRequest('http://localhost/api/auth/logout', {
      method: 'POST',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, message: '登出成功' });
    const cookieHeader = response.headers.get('set-cookie') || '';
    expect(cookieHeader).toContain('auth-token=;');
    expect(cookieHeader).toContain('token=;');
  });
});