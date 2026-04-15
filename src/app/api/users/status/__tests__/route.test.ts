import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/users/status/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockedPrismaUpdate = prisma.user.update as jest.MockedFunction<typeof prisma.user.update>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('users status route body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
  });

  it('rejects null request bodies before destructuring account status payload', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/users/status', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: 'null',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '參數錯誤' });
    expect(mockedPrismaUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before destructuring account status payload', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/users/status', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: '{"userId":',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrismaUpdate).not.toHaveBeenCalled();
  });
});