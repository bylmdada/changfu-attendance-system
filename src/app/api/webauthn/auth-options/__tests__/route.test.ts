jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    }
  }
}));

import { prisma } from '@/lib/database';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('webauthn auth-options guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects null request bodies before destructuring the username', async () => {
    const request = new Request('http://localhost/api/webauthn/auth-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供帳號' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before reading the username', async () => {
    const request = new Request('http://localhost/api/webauthn/auth-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"username":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns a generic error for inactive accounts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'inactive.user',
      isActive: false,
      employee: { id: 5 },
      webauthnCredentials: [{ credentialId: 'cred-1', transports: null }]
    } as never);

    const request = new Request('http://localhost/api/webauthn/auth-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'inactive.user' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無法使用 Face ID / 指紋登入');
    expect(payload.options).toBeUndefined();
    expect(payload.hasCredentials).toBeUndefined();
  });

  it('does not expose credential-existence flags on successful option creation', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 2,
      username: 'active.user',
      isActive: true,
      employee: { id: 6, name: 'Active User' },
      webauthnCredentials: [{ credentialId: 'cred-2', transports: null }]
    } as never);

    const request = new Request('http://localhost/api/webauthn/auth-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'active.user' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.options).toBeDefined();
    expect(payload.hasCredentials).toBeUndefined();
  });

  it('falls back to internal transport when stored transport JSON is malformed', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 3,
      username: 'active.user',
      isActive: true,
      employee: { id: 7, name: 'Active User' },
      webauthnCredentials: [{ credentialId: 'cred-3', transports: 'not-json' }]
    } as never);

    const request = new Request('http://localhost/api/webauthn/auth-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'active.user' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.options).toBeDefined();
  });
});