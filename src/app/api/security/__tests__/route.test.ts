import { NextRequest } from 'next/server';
import { POST } from '@/app/api/security/route';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { blockIP, unblockIP, cleanupSecurityData } from '@/lib/security-monitoring';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/security-monitoring', () => ({
  getSecurityStats: jest.fn(),
  getThreatDetails: jest.fn(),
  unblockIP: jest.fn(),
  blockIP: jest.fn(),
  exportSecurityEvents: jest.fn(),
  cleanupSecurityData: jest.fn(),
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedBlockIP = blockIP as jest.MockedFunction<typeof blockIP>;
const mockedUnblockIP = unblockIP as jest.MockedFunction<typeof unblockIP>;
const mockedCleanupSecurityData = cleanupSecurityData as jest.MockedFunction<typeof cleanupSecurityData>;

describe('security route csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('rejects null request bodies before destructuring security action payload', async () => {
    const response = await POST(new NextRequest('http://localhost/api/security', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: 'null',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的操作' });
    expect(mockedBlockIP).not.toHaveBeenCalled();
    expect(mockedUnblockIP).not.toHaveBeenCalled();
    expect(mockedCleanupSecurityData).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON before executing security actions', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(new NextRequest('http://localhost/api/security', {
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
    expect(mockedBlockIP).not.toHaveBeenCalled();
    expect(mockedUnblockIP).not.toHaveBeenCalled();
    expect(mockedCleanupSecurityData).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects POST when csrf validation fails before running security actions', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const response = await POST(new NextRequest('http://localhost/api/security', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({ action: 'block-ip', ip: '127.0.0.2' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockedBlockIP).not.toHaveBeenCalled();
    expect(mockedUnblockIP).not.toHaveBeenCalled();
    expect(mockedCleanupSecurityData).not.toHaveBeenCalled();
  });
});