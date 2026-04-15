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

import { prisma } from '@/lib/database';
import bcrypt from 'bcryptjs';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('webauthn register-options account guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});