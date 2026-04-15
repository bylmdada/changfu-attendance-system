import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/database';
import { normalizeStoredCredentialTransports, WEBAUTHN_RP_ID } from '@/lib/webauthn';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供帳號' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const username = isPlainObject(body) && typeof body.username === 'string'
      ? body.username
      : '';

    if (!username) {
      return NextResponse.json({ error: '請提供帳號' }, { status: 400 });
    }

    // 查詢用戶和已註冊的憑證
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        employee: true,
        webauthnCredentials: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: '無法使用 Face ID / 指紋登入' }, { status: 400 });
    }

    if (!user.isActive || !user.employee) {
      return NextResponse.json({ error: '無法使用 Face ID / 指紋登入' }, { status: 400 });
    }

    if (user.webauthnCredentials.length === 0) {
      return NextResponse.json({ error: '無法使用 Face ID / 指紋登入' }, { status: 400 });
    }

    const allowCredentials = user.webauthnCredentials.map(cred => ({
      id: cred.credentialId,
      transports: normalizeStoredCredentialTransports(cred.transports)
    }));

    const options = await generateAuthenticationOptions({
      rpID: WEBAUTHN_RP_ID,
      allowCredentials,
      timeout: 60000,
      userVerification: 'required',
    });

    const response = NextResponse.json({ options });
    response.cookies.set('webauthn_auth_challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 300
    });
    response.cookies.set('webauthn_auth_username', username, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 300
    });

    return response;
  } catch (error) {
    console.error('WebAuthn 驗證選項錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
