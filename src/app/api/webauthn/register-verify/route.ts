import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/database';
import { getAuthResultFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { cookies } from 'next/headers';
import {
  convertCredentialPublicKeyToSpki,
  getExpectedWebAuthnOrigins,
  normalizeRegistrationCredential,
  WEBAUTHN_RP_ID,
} from '@/lib/webauthn';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDuplicateCredentialError(error: unknown): boolean {
  if (!isPlainObject(error)) {
    return false;
  }

  return error.code === 'P2002';
}

function mapRegistrationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '未知錯誤';

  if (message.includes('Unexpected registration response challenge')) {
    return 'Challenge 驗證失敗';
  }

  if (message.includes('Unexpected registration response type')) {
    return 'Type 驗證失敗';
  }

  if (message.includes('Unexpected registration response origin')) {
    return '來源驗證失敗';
  }

  if (message.includes('Unexpected RP ID hash')) {
    return 'RP ID 驗證失敗';
  }

  if (
    message.includes('User verification')
    || message.includes('User not present')
  ) {
    return '生物識別驗證失敗';
  }

  if (
    message.includes('attestation')
    || message.includes('ECDSA')
    || message.includes('ASN1')
    || message.includes('signature')
  ) {
    return '註冊驗證失敗';
  }

  return message;
}

function normalizeDeviceName(deviceName: string | undefined): string {
  if (!deviceName) {
    return '未命名裝置';
  }

  const trimmed = deviceName.trim();
  return trimmed ? trimmed.slice(0, 100) : '未命名裝置';
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/webauthn/register-verify');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const authResult = await getAuthResultFromRequest(request);
    if (authResult.reason === 'session_invalid') {
      return NextResponse.json(
        {
          error: '您已在其他裝置登入，此會話已失效',
          code: 'SESSION_INVALID',
        },
        { status: 401 }
      );
    }

    if (!authResult.user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const cookieStore = await cookies();
    const challengeCookie = cookieStore.get('webauthn_challenge');
    const userIdCookie = cookieStore.get('webauthn_user_id');

    if (!challengeCookie || !userIdCookie) {
      return NextResponse.json({ error: '註冊會話已過期，請重新開始' }, { status: 400 });
    }

    const expectedChallenge = challengeCookie.value;
    const parsedUserId = parseIntegerQueryParam(userIdCookie.value, { min: 1, max: 99999999 });

    if (!parsedUserId.isValid || parsedUserId.value === null) {
      return NextResponse.json({ error: '註冊會話無效，請重新開始' }, { status: 400 });
    }

    if (parsedUserId.value !== authResult.user.userId) {
      return NextResponse.json({ error: '註冊會話與目前登入帳號不符，請重新開始' }, { status: 403 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const credential = isPlainObject(body) && isPlainObject(body.credential) ? body.credential : null;
    const deviceName = isPlainObject(body) && typeof body.deviceName === 'string'
      ? normalizeDeviceName(body.deviceName)
      : normalizeDeviceName(undefined);

    if (!credential || typeof credential.id !== 'string' || !isPlainObject(credential.response)) {
      return NextResponse.json({ error: '無效的憑證資料' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.userId },
      select: {
        id: true,
        isActive: true,
        employeeId: true
      }
    });

    if (!user || !user.isActive || !user.employeeId) {
      return NextResponse.json({ error: '帳號已停用或無有效員工資料' }, { status: 403 });
    }

    const normalizedCredential = normalizeRegistrationCredential(credential);

    let verification;

    try {
      verification = await verifyRegistrationResponse({
        response: normalizedCredential,
        expectedChallenge,
        expectedOrigin: getExpectedWebAuthnOrigins(),
        expectedRPID: WEBAUTHN_RP_ID,
        requireUserVerification: true,
      });
    } catch (error) {
      return NextResponse.json(
        { error: mapRegistrationErrorMessage(error) },
        { status: 400 }
      );
    }

    if (!verification.verified) {
      return NextResponse.json({ error: '註冊驗證失敗' }, { status: 400 });
    }

    const { credential: verifiedCredential } = verification.registrationInfo;

    await prisma.webAuthnCredential.create({
      data: {
        credentialId: verifiedCredential.id,
        publicKey: convertCredentialPublicKeyToSpki(verifiedCredential.publicKey),
        counter: verifiedCredential.counter,
        deviceName,
        transports: verifiedCredential.transports ? JSON.stringify(verifiedCredential.transports) : null,
        userId: user.id
      }
    });

    // 清除 cookies
    const response = NextResponse.json({ 
      success: true, 
      message: 'Face ID / 指紋註冊成功！'
    });
    response.cookies.delete('webauthn_challenge');
    response.cookies.delete('webauthn_user_id');

    return response;
  } catch (error) {
    if (isDuplicateCredentialError(error)) {
      return NextResponse.json({ error: '此裝置憑證已註冊' }, { status: 409 });
    }

    console.error('WebAuthn 註冊驗證錯誤:', error);
    return NextResponse.json({ 
      error: '註冊失敗：' + (error instanceof Error ? error.message : '未知錯誤')
    }, { status: 500 });
  }
}
