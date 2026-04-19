import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/database';
import { getAuthResultFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { normalizeStoredCredentialTransports, WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME } from '@/lib/webauthn';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/webauthn/register-options');
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

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供帳號和密碼' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const username = isPlainObject(body) && typeof body.username === 'string'
      ? body.username
      : '';
    const password = isPlainObject(body) && typeof body.password === 'string'
      ? body.password
      : '';

    if (!username || !password) {
      return NextResponse.json({ error: '請提供帳號和密碼' }, { status: 400 });
    }

    if (username !== authResult.user.username) {
      return NextResponse.json({ error: '僅能為目前登入帳號設定裝置' }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.userId },
      include: {
        employee: true,
        webauthnCredentials: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    if (!user.isActive || !user.employee) {
      return NextResponse.json({ error: '帳號已停用或無有效員工資料' }, { status: 403 });
    }

    // 驗證密碼
    const bcrypt = await import('bcryptjs');
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    const excludeCredentials = user.webauthnCredentials.map(cred => ({
      id: cred.credentialId,
      transports: normalizeStoredCredentialTransports(cred.transports)
    }));

    const options = await generateRegistrationOptions({
      rpName: WEBAUTHN_RP_NAME,
      rpID: WEBAUTHN_RP_ID,
      userName: user.username,
      userID: Buffer.from(user.id.toString(), 'utf8'),
      userDisplayName: user.employee?.name || username,
      timeout: 60000,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      excludeCredentials,
      supportedAlgorithmIDs: [-7, -257],
    });

    const response = NextResponse.json({ options });
    response.cookies.set('webauthn_challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 300 // 5 分鐘
    });
    response.cookies.set('webauthn_user_id', user.id.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 300
    });

    return response;
  } catch (error) {
    console.error('WebAuthn 註冊選項錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
