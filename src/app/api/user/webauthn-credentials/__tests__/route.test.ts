jest.mock('@/lib/database', () => ({
  prisma: {
    webAuthnCredential: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { DELETE } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('webauthn credentials route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({ userId: 9, employeeId: 9, role: 'EMPLOYEE' } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
  });

  it('rejects null delete bodies before destructuring credentialId', async () => {
    const request = new NextRequest('http://localhost/api/user/webauthn-credentials', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '缺少憑證 ID' });
    expect(mockPrisma.webAuthnCredential.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.delete).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed delete JSON before querying credentials', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/api/user/webauthn-credentials', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.webAuthnCredential.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.delete).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('requires csrf validation on DELETE requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost/api/user/webauthn-credentials', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ credentialId: 3 }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF token validation failed');
    expect(mockPrisma.webAuthnCredential.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.delete).not.toHaveBeenCalled();
  });

  it('does not allow deleting another user\'s credential even with a valid credential id', async () => {
    mockPrisma.webAuthnCredential.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/user/webauthn-credentials', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ credentialId: 12 }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: '憑證不存在或無權限刪除' });
    expect(mockPrisma.webAuthnCredential.findFirst).toHaveBeenCalledWith({
      where: {
        id: 12,
        userId: 9
      }
    });
    expect(mockPrisma.webAuthnCredential.delete).not.toHaveBeenCalled();
  });
});
