import { NextRequest } from 'next/server';
import { POST } from '@/app/api/performance/route';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { cleanupPerformanceData } from '@/lib/performance-monitoring';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/performance-monitoring', () => ({
  getSystemPerformance: jest.fn(),
  getEndpointPerformance: jest.fn(),
  detectPerformanceAnomalies: jest.fn(),
  getPerformanceRecommendations: jest.fn(),
  cleanupPerformanceData: jest.fn(),
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCleanupPerformanceData = cleanupPerformanceData as jest.MockedFunction<typeof cleanupPerformanceData>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('performance route csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('rejects POST when csrf validation fails before performance maintenance runs', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const response = await POST(new NextRequest('http://localhost/api/performance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({ action: 'cleanup', daysToKeep: 3 }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockedCleanupPerformanceData).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring performance maintenance payload', async () => {
    const response = await POST(new NextRequest('http://localhost/api/performance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: 'null',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '不支援的維護操作' });
    expect(mockedCleanupPerformanceData).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON before performance maintenance runs', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(new NextRequest('http://localhost/api/performance', {
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
    expect(mockedCleanupPerformanceData).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});