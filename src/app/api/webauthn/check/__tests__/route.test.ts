jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('webauthn check privacy guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue(null as never);
  });

  it('returns false for null request bodies before destructuring the username', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('http://localhost/api/webauthn/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ hasCredentials: false });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockGetUserFromRequest).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('returns 400 for malformed JSON bodies instead of swallowing parser failures', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('http://localhost/api/webauthn/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockGetUserFromRequest).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('does not reveal whether a typed username already has registered credentials to unauthenticated callers', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      isActive: true,
      employee: { id: 11 },
      webauthnCredentials: [
        {
          id: 7,
          deviceName: 'Alice iPhone',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          lastUsedAt: new Date('2025-01-02T00:00:00Z')
        }
      ]
    } as never);

    const request = new Request('http://localhost/api/webauthn/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ hasCredentials: false });
    expect(payload.credentials).toBeUndefined();
  });

  it('returns the actual credential status for the authenticated owner', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'alice',
      isActive: true,
      employee: { id: 11 },
      webauthnCredentials: [
        {
          id: 7,
          deviceName: 'Alice iPhone',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          lastUsedAt: new Date('2025-01-02T00:00:00Z')
        }
      ]
    } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 11,
      username: 'alice',
      role: 'USER',
      sessionId: 'session-1',
    } as never);

    const request = new Request('http://localhost/api/webauthn/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ hasCredentials: true });
  });

  it('returns false for inactive accounts instead of exposing biometric availability', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 2,
      username: 'inactive.user',
      isActive: false,
      employee: { id: 12 },
      webauthnCredentials: [{ id: 8 }]
    } as never);

    const request = new Request('http://localhost/api/webauthn/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'inactive.user' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ hasCredentials: false });
  });
});