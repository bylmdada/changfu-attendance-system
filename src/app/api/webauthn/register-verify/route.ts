import { NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/database';
import { cookies } from 'next/headers';
import {
  convertCredentialPublicKeyToSpki,
  getExpectedWebAuthnOrigins,
  normalizeRegistrationCredential,
  WEBAUTHN_RP_ID,
} from '@/lib/webauthn';
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

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const challengeCookie = cookieStore.get('webauthn_challenge');
    const userIdCookie = cookieStore.get('webauthn_user_id');

    if (!challengeCookie || !userIdCookie) {
      return NextResponse.json({ error: '註冊會話已過期，請重新開始' }, { status: 400 });
    }

    const expectedChallenge = challengeCookie.value;
    const userId = parseInt(userIdCookie.value);

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: '註冊會話無效，請重新開始' }, { status: 400 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const credential = isPlainObject(body) && isPlainObject(body.credential) ? body.credential : null;
    const deviceName = isPlainObject(body) && typeof body.deviceName === 'string' ? body.deviceName : undefined;

    if (!credential || typeof credential.id !== 'string' || !isPlainObject(credential.response)) {
      return NextResponse.json({ error: '無效的憑證資料' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
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
        deviceName: deviceName || '未命名裝置',
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
