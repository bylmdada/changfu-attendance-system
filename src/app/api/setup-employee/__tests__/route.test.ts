jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    employee: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { POST } from '../route';

const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('/api/setup-employee', () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    env.NODE_ENV = 'test';
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remainingRequests: 10, resetTime: Date.now() });
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ id: 1, role: 'ADMIN' } as never);
  });

  afterAll(() => {
    env.NODE_ENV = originalNodeEnv;
  });

  it('returns 404 in production before running setup logic', async () => {
    env.NODE_ENV = 'production';

    const request = new NextRequest('http://localhost/api/setup-employee', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'Not found' });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockValidateCSRF).not.toHaveBeenCalled();
    expect(mockGetUserFromRequest).not.toHaveBeenCalled();
  });
});