const mockPrisma = {
  user: {
    findUnique: jest.fn()
  }
};

jest.mock('@/lib/database', () => ({
  prisma: mockPrisma
}));

import jwt from 'jsonwebtoken';
import { getUserFromRequest, getUserFromToken, type JWTPayload } from '@/lib/auth';

describe('auth session validation', () => {
  const payload: JWTPayload = {
    userId: 1,
    employeeId: 100,
    username: 'alice',
    role: 'ADMIN',
    sessionId: 'session-1'
  };

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('accepts a token when the current session matches', async () => {
    jest.spyOn(jwt, 'verify').mockReturnValue(payload as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      isActive: true,
      currentSessionId: 'session-1'
    });

    await expect(getUserFromToken('valid-token')).resolves.toEqual(payload);
  });

  it('rejects a token when the session has been replaced', async () => {
    jest.spyOn(jwt, 'verify').mockReturnValue(payload as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      isActive: true,
      currentSessionId: 'session-2'
    });

    await expect(getUserFromToken('stale-token')).resolves.toBeNull();
  });

  it('applies the same session validation for request-based auth', async () => {
    jest.spyOn(jwt, 'verify').mockReturnValue(payload as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      isActive: true,
      currentSessionId: 'session-1'
    });

    const request = new Request('http://localhost/api/test', {
      headers: {
        authorization: 'Bearer request-token'
      }
    });

    await expect(getUserFromRequest(request)).resolves.toEqual(payload);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        id: true,
        isActive: true,
        currentSessionId: true
      }
    });
  });
});