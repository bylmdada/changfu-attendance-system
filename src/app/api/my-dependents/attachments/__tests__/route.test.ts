import { NextRequest } from 'next/server';
import { DELETE, POST } from '@/app/api/my-dependents/attachments/route';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {},
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('dependent attachments csrf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });
  });

  it('rejects POST requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-dependents/attachments', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('rejects DELETE requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-dependents/attachments?id=7', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });
});