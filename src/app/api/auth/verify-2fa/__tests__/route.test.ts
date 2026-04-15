jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('/api/auth/verify-2fa legacy route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
  });

  it('returns gone so callers must migrate to secure 2fa routes', async () => {
    const request = new NextRequest('http://localhost/api/auth/verify-2fa', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: '1', code: '123456' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(410);
    expect(payload).toEqual({
      error: '此驗證端點已停用，請改用 /api/auth/login 或 /api/auth/2fa/* 安全流程。',
    });
  });
});