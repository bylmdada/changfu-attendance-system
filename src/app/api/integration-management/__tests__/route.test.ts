import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import {
  initializeAPIIntegration,
  integrateAllAPIs,
  validateAPIIntegration,
} from '@/lib/api-integration';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/api-integration', () => ({
  integrateAllAPIs: jest.fn(),
  validateAPIIntegration: jest.fn(),
  generateIntegrationReport: jest.fn(),
  getAPICategoriesConfig: jest.fn(),
  getAPIsByCategory: jest.fn(),
  initializeAPIIntegration: jest.fn(),
}));

jest.mock('@/lib/api-gateway', () => ({
  apiGateway: {
    getStats: jest.fn(),
  },
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedInitializeAPIIntegration = initializeAPIIntegration as jest.MockedFunction<typeof initializeAPIIntegration>;
const mockedIntegrateAllAPIs = integrateAllAPIs as jest.MockedFunction<typeof integrateAllAPIs>;
const mockedValidateAPIIntegration = validateAPIIntegration as jest.MockedFunction<typeof validateAPIIntegration>;

describe('integration-management route body guards', () => {
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
    mockedInitializeAPIIntegration.mockReturnValue(true as never);
    mockedIntegrateAllAPIs.mockReturnValue({ integrationCoverage: 100 } as never);
    mockedValidateAPIIntegration.mockReturnValue({ success: true, gatewayRoutes: 20, issues: [] } as never);
  });

  it('rejects malformed json request bodies before dispatching integration actions', async () => {
    const response = await POST(new NextRequest('http://localhost/api/integration-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: '{"action":',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的整合管理操作' });
    expect(mockedInitializeAPIIntegration).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before dispatching integration actions', async () => {
    const response = await POST(new NextRequest('http://localhost/api/integration-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: 'null',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的整合管理操作' });
    expect(mockedInitializeAPIIntegration).not.toHaveBeenCalled();
  });

  it('rejects non-string action payloads before dispatching integration actions', async () => {
    const response = await POST(new NextRequest('http://localhost/api/integration-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({ action: 123 }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的操作類型' });
    expect(mockedInitializeAPIIntegration).not.toHaveBeenCalled();
  });
});