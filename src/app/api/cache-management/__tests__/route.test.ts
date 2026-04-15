import { NextRequest } from 'next/server';
import { POST } from '@/app/api/cache-management/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { CacheManager, globalCache, apiCache, dbCache } from '@/lib/intelligent-cache';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/intelligent-cache', () => ({
  CacheManager: {
    cleanupAll: jest.fn(),
    invalidateByTags: jest.fn(),
    clearAll: jest.fn(),
    getAllStats: jest.fn(),
  },
  globalCache: {
    clear: jest.fn(),
  },
  apiCache: {
    clear: jest.fn(),
  },
  dbCache: {
    clear: jest.fn(),
  },
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCacheManager = CacheManager as jest.Mocked<typeof CacheManager>;
const mockedGlobalCache = globalCache as jest.Mocked<typeof globalCache>;
const mockedApiCache = apiCache as jest.Mocked<typeof apiCache>;
const mockedDbCache = dbCache as jest.Mocked<typeof dbCache>;

describe('cache-management route body guards', () => {
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

  it('rejects null request bodies before destructuring cache maintenance payload', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cache-management', {
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
    expect(mockedCacheManager.cleanupAll).not.toHaveBeenCalled();
    expect(mockedCacheManager.invalidateByTags).not.toHaveBeenCalled();
    expect(mockedCacheManager.clearAll).not.toHaveBeenCalled();
    expect(mockedGlobalCache.clear).not.toHaveBeenCalled();
    expect(mockedApiCache.clear).not.toHaveBeenCalled();
    expect(mockedDbCache.clear).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before destructuring cache maintenance payload', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cache-management', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: '{"action":',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedCacheManager.cleanupAll).not.toHaveBeenCalled();
    expect(mockedCacheManager.invalidateByTags).not.toHaveBeenCalled();
    expect(mockedCacheManager.clearAll).not.toHaveBeenCalled();
    expect(mockedGlobalCache.clear).not.toHaveBeenCalled();
    expect(mockedApiCache.clear).not.toHaveBeenCalled();
    expect(mockedDbCache.clear).not.toHaveBeenCalled();
  });
});