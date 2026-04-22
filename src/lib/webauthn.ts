import crypto from 'crypto';
import type { AuthenticatorTransportFuture, RegistrationResponseJSON } from '@simplewebauthn/server';
import { convertCOSEtoPKCS, cose, isoCBOR } from '@simplewebauthn/server/helpers';

const AUTHENTICATOR_TRANSPORTS = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'] as const;

export const WEBAUTHN_RP_NAME = '長福會考勤系統';
export const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';

export function base64urlToBuffer(value: string): Buffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + '='.repeat(padLen), 'base64');
}

export function bufferToBase64url(value: ArrayBuffer | Buffer | Uint8Array): string {
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString('base64url');
  }

  return Buffer.from(value).toString('base64url');
}

export function normalizeBase64url(value: string): string {
  return bufferToBase64url(base64urlToBuffer(value));
}

export function normalizeRegistrationCredential(credential: {
  id?: string;
  rawId?: string;
  type?: string;
  clientExtensionResults?: Record<string, unknown>;
  response?: {
    clientDataJSON?: string;
    attestationObject?: string;
    transports?: string[];
  };
}): RegistrationResponseJSON {
  const transports = credential.response?.transports?.filter(
    (transport): transport is AuthenticatorTransportFuture => AUTHENTICATOR_TRANSPORTS.includes(transport as AuthenticatorTransportFuture)
  );

  return {
    id: normalizeBase64url(credential.id || credential.rawId || ''),
    rawId: normalizeBase64url(credential.rawId || credential.id || ''),
    type: 'public-key',
    clientExtensionResults: credential.clientExtensionResults || {},
    response: {
      clientDataJSON: normalizeBase64url(credential.response?.clientDataJSON || ''),
      attestationObject: normalizeBase64url(credential.response?.attestationObject || ''),
      transports,
    },
  };
}

export function normalizeStoredCredentialTransports(transports: string | null): AuthenticatorTransportFuture[] {
  if (!transports) {
    return ['internal'];
  }

  try {
    const parsed = JSON.parse(transports);

    if (Array.isArray(parsed)) {
      const normalized = parsed.filter(
        (transport): transport is AuthenticatorTransportFuture => (
          typeof transport === 'string' && AUTHENTICATOR_TRANSPORTS.includes(transport as AuthenticatorTransportFuture)
        )
      );

      return normalized.length > 0 ? normalized : ['internal'];
    }
  } catch {
    // Fall back to a safe default when legacy data contains malformed JSON.
  }

  return ['internal'];
}

export function getExpectedWebAuthnOrigins(extraOrigin?: string): string[] {
  const origins = new Set<string>([
    'https://localhost:3001',
    'https://127.0.0.1:3001',
    `https://${WEBAUTHN_RP_ID}:3001`,
  ]);

  if (extraOrigin?.startsWith('https://')) {
    origins.add(extraOrigin);
  }

  return [...origins];
}

export function extractCredentialCounter(authenticatorDataBase64url: string): number {
  const authData = base64urlToBuffer(authenticatorDataBase64url);
  return authData.readUInt32BE(33);
}

export function convertCredentialPublicKeyToSpki(credentialPublicKey: Uint8Array): string {
  return bufferToBase64url(convertCOSEtoPKCS(Uint8Array.from(credentialPublicKey)));
}

function encodeEc2PublicKey(point: Uint8Array): Uint8Array {
  if (point[0] !== 0x04) {
    throw new Error('Unsupported EC point format');
  }

  const pointMap: Record<number, { coordinateLength: number; curve: cose.COSECRV; algorithm: cose.COSEALG }> = {
    65: { coordinateLength: 32, curve: cose.COSECRV.P256, algorithm: cose.COSEALG.ES256 },
    97: { coordinateLength: 48, curve: cose.COSECRV.P384, algorithm: cose.COSEALG.ES384 },
    133: { coordinateLength: 66, curve: cose.COSECRV.P521, algorithm: cose.COSEALG.ES512 },
  };
  const mapped = pointMap[point.length];

  if (!mapped) {
    throw new Error('Unsupported EC public key length');
  }

  const x = point.slice(1, 1 + mapped.coordinateLength);
  const y = point.slice(1 + mapped.coordinateLength);
  const coseKey = new Map<number, number | Uint8Array>();

  coseKey.set(cose.COSEKEYS.kty, cose.COSEKTY.EC2);
  coseKey.set(cose.COSEKEYS.alg, mapped.algorithm);
  coseKey.set(cose.COSEKEYS.crv, mapped.curve);
  coseKey.set(cose.COSEKEYS.x, x);
  coseKey.set(cose.COSEKEYS.y, y);

  return Uint8Array.from(isoCBOR.encode(coseKey));
}

export function convertSpkiPublicKeyToCose(publicKeyBase64url: string): Uint8Array {
  const publicKeyBuffer = base64urlToBuffer(publicKeyBase64url);
  const publicKeyBytes = Uint8Array.from(publicKeyBuffer);

  try {
    const decoded = isoCBOR.decodeFirst(publicKeyBytes);

    if (decoded instanceof Map && decoded.has(cose.COSEKEYS.kty)) {
      return publicKeyBytes;
    }
  } catch {
    // Legacy or SPKI keys are handled by the conversions below.
  }

  if (publicKeyBuffer[0] === 0x04) {
    return encodeEc2PublicKey(publicKeyBytes);
  }

  const jwk = crypto.createPublicKey({
    key: publicKeyBuffer,
    format: 'der',
    type: 'spki',
  }).export({ format: 'jwk' }) as JsonWebKey;

  const coseKey = new Map<number, number | Uint8Array>();

  if (jwk.kty === 'EC') {
    const curveMap: Record<string, { curve: cose.COSECRV; algorithm: cose.COSEALG }> = {
      'P-256': { curve: cose.COSECRV.P256, algorithm: cose.COSEALG.ES256 },
      'P-384': { curve: cose.COSECRV.P384, algorithm: cose.COSEALG.ES384 },
      'P-521': { curve: cose.COSECRV.P521, algorithm: cose.COSEALG.ES512 },
    };
    const mapped = jwk.crv ? curveMap[jwk.crv] : undefined;

    if (!mapped || !jwk.x || !jwk.y) {
      throw new Error('Unsupported EC public key');
    }

    coseKey.set(cose.COSEKEYS.kty, cose.COSEKTY.EC2);
    coseKey.set(cose.COSEKEYS.alg, mapped.algorithm);
    coseKey.set(cose.COSEKEYS.crv, mapped.curve);
    coseKey.set(cose.COSEKEYS.x, Uint8Array.from(base64urlToBuffer(jwk.x)));
    coseKey.set(cose.COSEKEYS.y, Uint8Array.from(base64urlToBuffer(jwk.y)));
  } else if (jwk.kty === 'RSA') {
    if (!jwk.n || !jwk.e) {
      throw new Error('Unsupported RSA public key');
    }

    const algorithmMap: Record<string, cose.COSEALG> = {
      PS256: cose.COSEALG.PS256,
      PS384: cose.COSEALG.PS384,
      PS512: cose.COSEALG.PS512,
      RS384: cose.COSEALG.RS384,
      RS512: cose.COSEALG.RS512,
      RS1: cose.COSEALG.RS1,
      RS256: cose.COSEALG.RS256,
    };

    coseKey.set(cose.COSEKEYS.kty, cose.COSEKTY.RSA);
    coseKey.set(cose.COSEKEYS.alg, algorithmMap[jwk.alg || 'RS256'] || cose.COSEALG.RS256);
    coseKey.set(cose.COSEKEYS.n, Uint8Array.from(base64urlToBuffer(jwk.n)));
    coseKey.set(cose.COSEKEYS.e, Uint8Array.from(base64urlToBuffer(jwk.e)));
  } else if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.x) {
    coseKey.set(cose.COSEKEYS.kty, cose.COSEKTY.OKP);
    coseKey.set(cose.COSEKEYS.alg, cose.COSEALG.EdDSA);
    coseKey.set(cose.COSEKEYS.crv, cose.COSECRV.ED25519);
    coseKey.set(cose.COSEKEYS.x, Uint8Array.from(base64urlToBuffer(jwk.x)));
  } else {
    throw new Error('Unsupported public key type');
  }

  return Uint8Array.from(isoCBOR.encode(coseKey));
}
