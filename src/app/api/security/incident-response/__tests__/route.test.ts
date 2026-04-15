import { NextRequest } from 'next/server';
import { POST } from '@/app/api/security/incident-response/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { blockIP, unblockIP, logSecurityEvent } from '@/lib/security-monitoring';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/security-monitoring', () => ({
  logSecurityEvent: jest.fn(),
  SecurityEventType: {
    SUSPICIOUS_REQUEST: 'SUSPICIOUS_REQUEST',
    AUTHENTICATION_SUCCESS: 'AUTHENTICATION_SUCCESS',
    PRIVILEGE_ESCALATION: 'PRIVILEGE_ESCALATION',
  },
  blockIP: jest.fn(),
  unblockIP: jest.fn(),
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedBlockIP = blockIP as jest.MockedFunction<typeof blockIP>;
const mockedUnblockIP = unblockIP as jest.MockedFunction<typeof unblockIP>;
const mockedLogSecurityEvent = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;

describe('security incident-response route body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
  });

  it('rejects null request bodies before destructuring incident response payload', async () => {
    const response = await POST(new NextRequest('http://localhost/api/security/incident-response', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: 'null',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '缺少必要參數' });
    expect(mockedBlockIP).not.toHaveBeenCalled();
    expect(mockedUnblockIP).not.toHaveBeenCalled();
    expect(mockedLogSecurityEvent).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before destructuring incident response payload', async () => {
    const response = await POST(new NextRequest('http://localhost/api/security/incident-response', {
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
    expect(mockedBlockIP).not.toHaveBeenCalled();
    expect(mockedUnblockIP).not.toHaveBeenCalled();
    expect(mockedLogSecurityEvent).not.toHaveBeenCalled();
  });
});