import { NextRequest } from 'next/server';
import { POST } from '@/app/api/overtime-requests/batch/route';
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

jest.mock('@/lib/salary-utils', () => ({
  calculateOvertimePayForRequest: jest.fn(),
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('overtime batch csrf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });
  });

  it('rejects POST requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['1', '2'], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before parsing batch payload', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 77,
      userId: 777,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的批次審核資料');
  });

  it('rejects malformed JSON bodies before parsing batch payload', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 77,
      userId: 777,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/batch', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: '{"ids":',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
  });
});