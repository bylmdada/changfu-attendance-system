jest.mock('@/lib/auth', () => ({
  getAuthResultFromRequest: jest.fn()
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    }
  }
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/verify/route';
import { getAuthResultFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';

const mockGetAuthResultFromRequest = getAuthResultFromRequest as jest.MockedFunction<typeof getAuthResultFromRequest>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('/api/auth/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns SESSION_INVALID when the session was replaced', async () => {
    mockGetAuthResultFromRequest.mockResolvedValue({
      user: null,
      reason: 'session_invalid'
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/auth/verify'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: '您已在其他裝置登入，此會話已失效',
      code: 'SESSION_INVALID'
    });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a valid authenticated request and returns the minimal user payload', async () => {
    mockGetAuthResultFromRequest.mockResolvedValue({
      user: {
        userId: 5,
        employeeId: 12,
        username: 'alice',
        role: 'ADMIN',
        sessionId: 'session-1'
      },
      reason: null
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 5,
      username: 'alice',
      role: 'ADMIN',
      isActive: true,
      currentSessionId: 'session-1',
      employee: {
        id: 12,
        employeeId: 'EMP012',
        name: 'Alice',
        department: 'HR',
        position: 'Manager',
        isActive: true
      }
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/auth/verify'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      id: 5,
      username: 'alice',
      role: 'ADMIN',
      employee: {
        id: 12,
        employeeId: 'EMP012',
        name: 'Alice',
        department: 'HR',
        position: 'Manager'
      }
    });
  });
});