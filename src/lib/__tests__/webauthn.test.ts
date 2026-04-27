import crypto from 'crypto';
import { cose, isoCBOR } from '@simplewebauthn/server/helpers';
import { base64urlToBuffer, convertSpkiPublicKeyToCose } from '@/lib/webauthn';

describe('webauthn public key conversion', () => {
  it('converts stored SPKI public keys back into COSE format for authentication verification', () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;

    const coseKey = isoCBOR.decodeFirst(
      convertSpkiPublicKeyToCose(spki) as unknown as Uint8Array<ArrayBuffer>
    ) as Map<number, number | Uint8Array>;

    expect(coseKey.get(cose.COSEKEYS.kty)).toBe(cose.COSEKTY.EC2);
    expect(coseKey.get(cose.COSEKEYS.alg)).toBe(cose.COSEALG.ES256);
    expect(coseKey.get(cose.COSEKEYS.crv)).toBe(cose.COSECRV.P256);
    expect(Buffer.from(coseKey.get(cose.COSEKEYS.x) as Uint8Array)).toEqual(base64urlToBuffer(jwk.x!));
    expect(Buffer.from(coseKey.get(cose.COSEKEYS.y) as Uint8Array)).toEqual(base64urlToBuffer(jwk.y!));
  });

  it('supports the raw EC point format currently produced by registration storage', () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const rawPoint = Buffer.concat([
      Buffer.from([0x04]),
      base64urlToBuffer(jwk.x!),
      base64urlToBuffer(jwk.y!),
    ]).toString('base64url');

    const coseKey = isoCBOR.decodeFirst(
      convertSpkiPublicKeyToCose(rawPoint) as unknown as Uint8Array<ArrayBuffer>
    ) as Map<number, number | Uint8Array>;

    expect(coseKey.get(cose.COSEKEYS.kty)).toBe(cose.COSEKTY.EC2);
    expect(coseKey.get(cose.COSEKEYS.alg)).toBe(cose.COSEALG.ES256);
    expect(coseKey.get(cose.COSEKEYS.crv)).toBe(cose.COSECRV.P256);
    expect(Buffer.from(coseKey.get(cose.COSEKEYS.x) as Uint8Array)).toEqual(base64urlToBuffer(jwk.x!));
    expect(Buffer.from(coseKey.get(cose.COSEKEYS.y) as Uint8Array)).toEqual(base64urlToBuffer(jwk.y!));
  });

  it('passes already-COSE public keys through unchanged', () => {
    const coseKey = new Map<number, number | Uint8Array>();
    coseKey.set(cose.COSEKEYS.kty, cose.COSEKTY.EC2);
    coseKey.set(cose.COSEKEYS.alg, cose.COSEALG.ES256);
    coseKey.set(cose.COSEKEYS.crv, cose.COSECRV.P256);
    coseKey.set(cose.COSEKEYS.x, new Uint8Array(32).fill(1));
    coseKey.set(cose.COSEKEYS.y, new Uint8Array(32).fill(2));

    const encodedCoseKey = Buffer.from(isoCBOR.encode(coseKey)).toString('base64url');

    expect(convertSpkiPublicKeyToCose(encodedCoseKey)).toEqual(Uint8Array.from(base64urlToBuffer(encodedCoseKey)));
  });
});

describe('webauthn origin helpers', () => {
  const originalRpId = process.env.WEBAUTHN_RP_ID;

  async function loadWebAuthnHelpers(rpId?: string) {
    jest.resetModules();

    if (rpId) {
      process.env.WEBAUTHN_RP_ID = rpId;
    } else {
      delete process.env.WEBAUTHN_RP_ID;
    }

    return import('@/lib/webauthn');
  }

  afterEach(() => {
    jest.resetModules();

    if (originalRpId) {
      process.env.WEBAUTHN_RP_ID = originalRpId;
    } else {
      delete process.env.WEBAUTHN_RP_ID;
    }
  });

  it('accepts forwarded production origins even when the internal request URL is localhost', async () => {
    const { getExpectedWebAuthnOrigins, getWebAuthnRequestOrigins } = await loadWebAuthnHelpers('changfu.me');
    const request = new Request('http://127.0.0.1:3000/api/webauthn/auth-verify', {
      headers: {
        origin: 'https://changfu.me',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'changfu.me',
        host: '127.0.0.1:3000',
      },
    });

    const expectedOrigins = getExpectedWebAuthnOrigins(getWebAuthnRequestOrigins(request));

    expect(expectedOrigins).toEqual(expect.arrayContaining([
      'https://changfu.me',
      'http://127.0.0.1:3000',
    ]));
  });

  it('rejects forwarded origins outside the configured RP ID', async () => {
    const { getExpectedWebAuthnOrigins, getWebAuthnRequestOrigins } = await loadWebAuthnHelpers('changfu.me');
    const request = new Request('http://127.0.0.1:3000/api/webauthn/auth-verify', {
      headers: {
        origin: 'https://evil.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
        host: '127.0.0.1:3000',
      },
    });

    const expectedOrigins = getExpectedWebAuthnOrigins(getWebAuthnRequestOrigins(request));

    expect(expectedOrigins).not.toContain('https://evil.example');
    expect(expectedOrigins).toEqual(expect.arrayContaining([
      'https://changfu.me',
      'http://127.0.0.1:3000',
    ]));
  });

  it('keeps localhost origins available for local development', async () => {
    const { getExpectedWebAuthnOrigins } = await loadWebAuthnHelpers();

    expect(getExpectedWebAuthnOrigins()).toEqual(expect.arrayContaining([
      'https://localhost',
      'http://localhost',
      'https://localhost:3001',
      'http://localhost:3001',
    ]));
  });
});
