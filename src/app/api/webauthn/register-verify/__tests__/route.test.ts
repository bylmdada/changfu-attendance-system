jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    },
    webAuthnCredential: {
      create: jest.fn()
    }
  }
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn()
}));

jest.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: jest.fn()
}));

jest.mock('@/lib/webauthn', () => {
  const actual = jest.requireActual('@/lib/webauthn');

  return {
    ...actual,
    convertCredentialPublicKeyToSpki: jest.fn(() => 'mock-spki-public-key')
  };
});

import { prisma } from '@/lib/database';
import { cookies } from 'next/headers';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockVerifyRegistrationResponse = verifyRegistrationResponse as jest.MockedFunction<typeof verifyRegistrationResponse>;

describe('webauthn register-verify account guard', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.webAuthnCredential.create.mockReset();
    mockCookies.mockReset();
    mockVerifyRegistrationResponse.mockReset();
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === 'webauthn_challenge') return { value: 'challenge-1' };
        if (name === 'webauthn_user_id') return { value: '7' };
        return undefined;
      })
    } as never);
  });

  it('rejects null request bodies before destructuring registration verification payload', async () => {
    const request = new Request('http://localhost/api/webauthn/register-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的憑證資料' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.create).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON bodies before registration verification starts', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('http://localhost/api/webauthn/register-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.create).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('does not require a client-supplied public key before reaching account checks', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      isActive: false,
      employeeId: 22
    } as never);

    const request = new Request('http://localhost/api/webauthn/register-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        credential: {
          id: 'cred-1',
          response: {
            clientDataJSON: Buffer.from(JSON.stringify({
              challenge: 'challenge-1',
              origin: 'https://localhost:3001',
              type: 'webauthn.create'
            })).toString('base64url'),
            attestationObject: Buffer.concat([
              Buffer.from([0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61, 0x58, 0x25]),
              Buffer.alloc(37)
            ]).toString('base64url'),
            transports: ['internal']
          }
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('帳號已停用或無有效員工資料');
    expect(mockPrisma.webAuthnCredential.create).not.toHaveBeenCalled();
  });

  it('returns a 400 validation error when WebAuthn origin verification fails', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      isActive: true,
      employeeId: 22,
    } as never);
    mockVerifyRegistrationResponse.mockRejectedValue(
      new Error('Unexpected registration response origin "https://evil.example.com", expected one of: https://localhost:3001') as never
    );

    const request = new Request('http://localhost/api/webauthn/register-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        credential: {
          id: 'cred-1',
          type: 'public-key',
          rawId: 'cred-1',
          response: {
            clientDataJSON: 'client-data',
            attestationObject: 'attestation-object',
            transports: ['internal']
          }
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '來源驗證失敗' });
    expect(mockPrisma.webAuthnCredential.create).not.toHaveBeenCalled();
  });

  it('returns a conflict when the credential is already registered', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      isActive: true,
      employeeId: 22,
    } as never);
    mockVerifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        }
      }
    } as never);
    mockPrisma.webAuthnCredential.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`credential_id`)'), {
        code: 'P2002'
      }) as never
    );

    const request = new Request('http://localhost/api/webauthn/register-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        credential: {
          id: 'cred-1',
          type: 'public-key',
          rawId: 'cred-1',
          response: {
            clientDataJSON: 'client-data',
            attestationObject: 'attestation-object',
            transports: ['internal']
          }
        },
        deviceName: 'Alice iPhone'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: '此裝置憑證已註冊' });
  });

  it('rejects malformed user id cookies before querying the database', async () => {
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === 'webauthn_challenge') return { value: 'challenge-1' };
        if (name === 'webauthn_user_id') return { value: 'not-a-number' };
        return undefined;
      })
    } as never);
    mockPrisma.user.findUnique.mockRejectedValue(new Error('Invalid value for argument `id`: NaN'));

    const request = new Request('http://localhost/api/webauthn/register-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        credential: {
          id: 'cred-1',
          response: {
            clientDataJSON: 'client-data',
            attestationObject: 'attestation-object'
          }
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '註冊會話無效，請重新開始' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.create).not.toHaveBeenCalled();
  });
});