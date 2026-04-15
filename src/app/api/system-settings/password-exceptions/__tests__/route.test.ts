jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findFirst: jest.fn(),
    },
    passwordException: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST, DELETE } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('password exceptions route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      userId: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('rejects unauthenticated GET requests before querying exceptions', async () => {
    mockGetUserFromRequest.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
    expect(mockPrisma.passwordException.findMany).not.toHaveBeenCalled();
  });

  it('rejects null bodies on POST before destructuring exception fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.passwordException.create).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated DELETE requests before deleting exceptions', async () => {
    mockGetUserFromRequest.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 99 }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
    expect(mockPrisma.passwordException.delete).not.toHaveBeenCalled();
  });
  it('rejects null bodies on DELETE before destructuring exception ids', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.passwordException.delete).not.toHaveBeenCalled();
  });

  it('rejects DELETE when csrf validation fails', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false } as never);

    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({ id: 99 }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.passwordException.delete).not.toHaveBeenCalled();
  });

  it('rejects invalid employee ids on POST before querying employees', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        employeeId: 'abc',
        exceptionType: 'PASSWORD_BYPASS',
        reason: 'test',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('員工ID格式無效');
    expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('rejects invalid expiration dates on POST before creating exceptions', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        employeeId: 12,
        exceptionType: 'PASSWORD_BYPASS',
        reason: 'test',
        expiresAt: 'not-a-date',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('到期日期格式無效');
    expect(mockPrisma.passwordException.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on POST before reading exception fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"employeeId":12,"exceptionType":"PASSWORD_BYPASS"',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.passwordException.create).not.toHaveBeenCalled();
  });

  it('rejects null bodies on POST before destructuring exception fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.passwordException.create).not.toHaveBeenCalled();
  });

  it('rejects invalid exception ids on DELETE before deleting exceptions', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({ id: 'abc' }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('例外ID格式無效');
    expect(mockPrisma.passwordException.delete).not.toHaveBeenCalled();
  });

  it('rejects null bodies on DELETE before destructuring exception ids', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/password-exceptions', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.passwordException.delete).not.toHaveBeenCalled();
  });
});