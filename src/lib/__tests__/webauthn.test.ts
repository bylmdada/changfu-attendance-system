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
});