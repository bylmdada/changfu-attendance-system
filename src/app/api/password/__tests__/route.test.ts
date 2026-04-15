jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
  validatePassword: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}));

import { NextRequest } from 'next/server';
import { POST, PUT } from '@/app/api/password/route';
import { getUserFromRequest, validatePassword, verifyPassword, hashPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidatePassword = validatePassword as jest.MockedFunction<typeof validatePassword>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockHashPassword = hashPassword as jest.MockedFunction<typeof hashPassword>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('/api/password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockValidatePassword.mockReturnValue({ isValid: true, errors: [] });
    mockVerifyPassword.mockResolvedValue(true);
    mockHashPassword.mockResolvedValue('hashed-password');
  });

  it('rejects PUT when the request is not authenticated', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ currentPassword: 'Old123!!', newPassword: 'New123!!' })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '未授權訪問' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null PUT bodies before destructuring password change fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: 'null'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '當前密碼和新密碼為必填' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockHashPassword).not.toHaveBeenCalled();
  });

  it('rejects malformed PUT JSON before destructuring password change fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"currentPassword":'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockHashPassword).not.toHaveBeenCalled();
  });

  it('allows only ADMIN and HR to reset another user password', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ userId: '8', newPassword: 'New123!!' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '權限不足' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before destructuring password reset fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'admin',
      role: 'ADMIN'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '用戶ID和新密碼為必填' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockHashPassword).not.toHaveBeenCalled();
  });

  it('rejects malformed POST JSON before destructuring password reset fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'admin',
      role: 'ADMIN'
    } as never);

    const request = new NextRequest('http://localhost/api/password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"userId":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockHashPassword).not.toHaveBeenCalled();
  });
});