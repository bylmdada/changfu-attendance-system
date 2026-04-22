jest.mock('@/lib/database', () => ({
  prisma: {
    webAuthnCredential: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn()
}));

jest.mock('@/lib/device-detection', () => ({
  isMobileClockingDevice: jest.fn(),
  MOBILE_CLOCKING_REQUIRED_MESSAGE: 'mobile only'
}));

import { prisma } from '@/lib/database';
import { cookies } from 'next/headers';
import { isMobileClockingDevice } from '@/lib/device-detection';
import { convertSpkiPublicKeyToCose } from '@/lib/webauthn';
import * as crypto from 'crypto';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockIsMobileClockingDevice = isMobileClockingDevice as jest.MockedFunction<typeof isMobileClockingDevice>;

function createAuthenticatorData(flags: number, counter: number) {
  const authData = Buffer.alloc(37);
  crypto.createHash('sha256').update('localhost').digest().copy(authData, 0);
  authData[32] = flags;
  authData.writeUInt32BE(counter, 33);
  return authData;
}

function createSignedCredential(options?: {
  rpId?: string;
  flags?: number;
  counter?: number;
  challenge?: string;
  origin?: string;
  credentialId?: string;
  type?: string;
  rawId?: string;
  storedPublicKeyFormat?: 'spki' | 'cose';
}) {
  const {
    rpId = 'localhost',
    flags = 0x05,
    counter = 1,
    challenge = 'challenge-1',
    origin = 'https://localhost:3001',
    credentialId = 'cred-1',
    type = 'public-key',
    rawId,
    storedPublicKeyFormat = 'spki',
  } = options || {};

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const exportedPublicKey = publicKey.export({ format: 'der', type: 'spki' });

  const authData = Buffer.alloc(37);
  crypto.createHash('sha256').update(rpId).digest().copy(authData, 0);
  authData[32] = flags;
  authData.writeUInt32BE(counter, 33);

  const clientDataJSONBuffer = Buffer.from(JSON.stringify({
    challenge,
    type: 'webauthn.get',
    origin,
  }));
  const clientDataHash = crypto.createHash('sha256').update(clientDataJSONBuffer).digest();
  const signature = crypto.sign('sha256', Buffer.concat([authData, clientDataHash]), privateKey);
  const storedPublicKey = storedPublicKeyFormat === 'cose'
    ? Buffer.from(convertSpkiPublicKeyToCose(exportedPublicKey.toString('base64url'))).toString('base64url')
    : exportedPublicKey.toString('base64url');

  return {
    storedPublicKey,
    requestBody: {
      credential: {
        id: credentialId,
        rawId,
        type,
        response: {
          clientDataJSON: clientDataJSONBuffer.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      },
    },
  };
}

describe('webauthn auth-verify account status guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMobileClockingDevice.mockReturnValue(true);
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === 'webauthn_auth_challenge') return { value: 'challenge-1' };
        if (name === 'webauthn_auth_username') return { value: 'inactive.user' };
        return undefined;
      })
    } as never);
  });

  it('rejects assertions when signature verification fails', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const exportedPublicKey = publicKey.export({ format: 'der', type: 'spki' });

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 1,
      credentialId: 'cred-1',
      publicKey: exportedPublicKey.toString('base64url'),
      counter: 0,
      user: {
        id: 3,
        username: 'inactive.user',
        isActive: true,
        employee: { id: 20 },
        employeeId: 20,
      }
    } as never);

    const authData = createAuthenticatorData(0x05, 1);
    const signature = Buffer.alloc(64, 1);
    const clientDataJSON = Buffer.from(JSON.stringify({
      challenge: 'challenge-1',
      type: 'webauthn.get',
      origin: 'https://localhost:3001'
    })).toString('base64url');

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify({
        credential: {
          id: 'cred-1',
          response: {
            clientDataJSON,
            authenticatorData: authData.toString('base64url'),
            signature: signature.toString('base64url')
          }
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('簽名驗證失敗');
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('verifies a valid assertion and updates the usage counter', async () => {
    const signedCredential = createSignedCredential();

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 1,
      credentialId: 'cred-1',
      publicKey: signedCredential.storedPublicKey,
      counter: 0,
      user: {
        id: 3,
        username: 'inactive.user',
        isActive: true,
        employee: { id: 20, name: 'Alice' },
        employeeId: 20,
      }
    } as never);

    mockPrisma.webAuthnCredential.update.mockResolvedValue({} as never);

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify(signedCredential.requestBody)
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.verified).toBe(true);
    expect(payload.user.username).toBe('inactive.user');
    expect(mockPrisma.webAuthnCredential.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        counter: 1,
        lastUsedAt: expect.any(Date),
      }),
    });
  });

  it('verifies a valid assertion when the stored public key uses the legacy COSE format', async () => {
    const signedCredential = createSignedCredential({ storedPublicKeyFormat: 'cose' });

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 1,
      credentialId: 'cred-1',
      publicKey: signedCredential.storedPublicKey,
      counter: 0,
      user: {
        id: 3,
        username: 'inactive.user',
        isActive: true,
        employee: { id: 20, name: 'Alice' },
        employeeId: 20,
      }
    } as never);

    mockPrisma.webAuthnCredential.update.mockResolvedValue({} as never);

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify(signedCredential.requestBody)
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.verified).toBe(true);
    expect(mockPrisma.webAuthnCredential.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        counter: 1,
        lastUsedAt: expect.any(Date),
      }),
    });
  });

  it('rejects assertions from unexpected origins before verifying signatures', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const exportedPublicKey = publicKey.export({ format: 'der', type: 'spki' });

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 1,
      credentialId: 'cred-1',
      publicKey: exportedPublicKey.toString('base64url'),
      counter: 0,
      user: {
        id: 3,
        username: 'inactive.user',
        isActive: true,
        employee: { id: 20 },
        employeeId: 20,
      }
    } as never);

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify({
        credential: {
          id: 'cred-1',
          response: {
            clientDataJSON: Buffer.from(JSON.stringify({
              challenge: 'challenge-1',
              type: 'webauthn.get',
              origin: 'https://evil.example.com'
            })).toString('base64url'),
            authenticatorData: createAuthenticatorData(0x05, 1).toString('base64url'),
            signature: Buffer.alloc(64, 1).toString('base64url')
          }
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('來源驗證失敗');
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('rejects assertions when the RP ID hash does not match', async () => {
    const signedCredential = createSignedCredential({ rpId: 'evil.example.com' });

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 1,
      credentialId: 'cred-1',
      publicKey: signedCredential.storedPublicKey,
      counter: 0,
      user: {
        id: 3,
        username: 'inactive.user',
        isActive: true,
        employee: { id: 20 },
        employeeId: 20,
      }
    } as never);

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify(signedCredential.requestBody)
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('RP ID 驗證失敗');
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('rejects assertions without user verification flags', async () => {
    const signedCredential = createSignedCredential({ flags: 0x01 });

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 1,
      credentialId: 'cred-1',
      publicKey: signedCredential.storedPublicKey,
      counter: 0,
      user: {
        id: 3,
        username: 'inactive.user',
        isActive: true,
        employee: { id: 20 },
        employeeId: 20,
      }
    } as never);

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify(signedCredential.requestBody)
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('生物識別驗證失敗');
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('rejects non-advancing counters before updating credential state', async () => {
    const signedCredential = createSignedCredential({ counter: 2 });

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 1,
      credentialId: 'cred-1',
      publicKey: signedCredential.storedPublicKey,
      counter: 2,
      user: {
        id: 3,
        username: 'inactive.user',
        isActive: true,
        employee: { id: 20 },
        employeeId: 20,
      }
    } as never);

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify(signedCredential.requestBody)
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('可能的重放攻擊');
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('rejects mismatched rawId values before credential lookup', async () => {
    const signedCredential = createSignedCredential({ rawId: 'different-cred' });

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify(signedCredential.requestBody)
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('憑證 ID 不一致');
    expect(mockPrisma.webAuthnCredential.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring credential payload', async () => {
    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的憑證資料' });
    expect(mockPrisma.webAuthnCredential.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON bodies before verification starts', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: '{'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.webAuthnCredential.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects invalid GPS payloads before credential lookup', async () => {
    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify({
        clockType: 'in',
        location: {
          latitude: 25.0,
          longitude: 181,
          accuracy: 10,
        },
        credential: {
          id: 'cred-1',
          response: {
            clientDataJSON: '',
            authenticatorData: '',
            signature: ''
          }
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'GPS定位資料格式錯誤' });
    expect(mockPrisma.webAuthnCredential.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts before processing WebAuthn assertions', async () => {
    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: 1,
      credentialId: 'cred-1',
      publicKey: 'public-key',
      counter: 0,
      user: {
        id: 3,
        username: 'inactive.user',
        isActive: false,
        employee: { id: 20 }
      }
    } as never);

    const request = new Request('http://localhost/api/webauthn/auth-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify({
        credential: {
          id: 'cred-1',
          response: {
            clientDataJSON: '',
            authenticatorData: '',
            signature: ''
          }
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('帳號已停用，請聯繫管理員');
    expect(mockPrisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });
});
