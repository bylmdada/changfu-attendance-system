jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    }
  }
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn()
}));

jest.mock('@/lib/auth', () => ({
  getAuthResultFromRequest: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

import { prisma } from '@/lib/database';
import bcrypt from 'bcryptjs';
import { getAuthResultFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockGetAuthResultFromRequest = getAuthResultFromRequest as jest.MockedFunction<typeof getAuthResultFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('webauthn register-options account guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remainingRequests: 4,
      resetTime: Date.now() + 1000,
    });
    mockGetAuthResultFromRequest.mockResolvedValue({
      user: {
        userId: 8,
        employeeId: 31,
        username: 'active.user',
        role: 'EMPLOYEE',
        sessionId: 'session-1'
      },
      reason: null
    } as never);
  });

  it('rejects null request bodies before destructuring registration credentials', async () => {
    const response = await POST(new Request('http://localhost/api/webauthn/register-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供帳號和密碼' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockBcrypt.compare).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before reading registration credentials', async () => {
    const response = await POST(new Request('http://localhost/api/webauthn/register-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"username":'
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockBcrypt.compare).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts before issuing registration cookies', async () => {
    mockGetAuthResultFromRequest.mockResolvedValue({
      user: {
        userId: 7,
        employeeId: 30,
        username: 'disabled.user',
        role: 'EMPLOYEE',
        sessionId: 'session-1'
      },
      reason: null
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      username: 'disabled.user',
      passwordHash: 'hash',
      isActive: false,
      employee: { id: 30 },
      webauthnCredentials: []
    } as never);
    mockBcrypt.compare.mockResolvedValue(true as never);

    const response = await POST(new Request('http://localhost/api/webauthn/register-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'disabled.user', password: 'Password123!' })
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('帳號已停用或無有效員工資料');
  });

  it('falls back to internal transport when stored transport JSON is malformed', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 8,
      username: 'active.user',
      passwordHash: 'hash',
      isActive: true,
      employee: { id: 31, name: 'Active User' },
      webauthnCredentials: [{ credentialId: 'cred-4', transports: 'not-json' }]
    } as never);
    mockBcrypt.compare.mockResolvedValue(true as never);

    const response = await POST(new Request('http://localhost/api/webauthn/register-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'active.user', password: 'Password123!' })
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.options).toBeDefined();
  });

  it('rejects attempts to register a device for a different logged-in account', async () => {
    const response = await POST(new Request('http://localhost/api/webauthn/register-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'other.user', password: 'Password123!' })
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '僅能為目前登入帳號設定裝置' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockBcrypt.compare).not.toHaveBeenCalled();
  });
});
