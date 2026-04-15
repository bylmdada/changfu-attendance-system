import { NextRequest } from 'next/server';
import { POST } from '@/app/api/gateway-management/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { apiGateway } from '@/lib/api-gateway';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/api-gateway', () => ({
  apiGateway: {
    setGlobalConfig: jest.fn(),
    clear: jest.fn(),
    register: jest.fn(),
    getStats: jest.fn(),
  },
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedApiGateway = apiGateway as jest.Mocked<typeof apiGateway>;

describe('gateway-management route body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
  });

  it('rejects null request bodies before destructuring gateway management payload', async () => {
    const response = await POST(new NextRequest('http://localhost/api/gateway-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: 'null',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '不支援的操作類型' });
    expect(mockedApiGateway.setGlobalConfig).not.toHaveBeenCalled();
    expect(mockedApiGateway.clear).not.toHaveBeenCalled();
    expect(mockedApiGateway.register).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON before mutating gateway configuration', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(new NextRequest('http://localhost/api/gateway-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: '{',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedApiGateway.setGlobalConfig).not.toHaveBeenCalled();
    expect(mockedApiGateway.clear).not.toHaveBeenCalled();
    expect(mockedApiGateway.register).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});