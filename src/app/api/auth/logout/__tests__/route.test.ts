jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ getUserFromRequest: jest.fn() }));
jest.mock('@/lib/database', () => ({ prisma: { user: { updateMany: jest.fn() } } }));

import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { POST } from '../route';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';

const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('/api/auth/logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remainingRequests: 10, resetTime: Date.now() });
    mockValidateCSRF.mockResolvedValue({ valid: true });
    (getUserFromRequest as jest.Mock).mockResolvedValue(null);
    (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  it('revokes only the session being logged out, preserving a newer login', async () => {
    (getUserFromRequest as jest.Mock).mockResolvedValue({ userId: 1, sessionId: 'old-session' });
    const response = await POST(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1, currentSessionId: 'old-session' }, data: { currentSessionId: null },
    });
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
