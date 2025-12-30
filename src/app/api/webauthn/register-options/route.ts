import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import crypto from 'crypto';

// WebAuthn 設定
const RP_NAME = '長福會考勤系統';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: '請提供帳號和密碼' }, { status: 400 });
    }

    // 驗證帳密
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        employee: true,
        webauthnCredentials: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    // 驗證密碼
    const bcrypt = await import('bcryptjs');
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    // 生成 challenge
    const challenge = crypto.randomBytes(32);
    const challengeBase64 = challenge.toString('base64url');

    // 已註冊的憑證 ID（排除重複註冊）
    const excludeCredentials = user.webauthnCredentials.map(cred => ({
      id: cred.credentialId,
      type: 'public-key' as const,
      transports: cred.transports ? JSON.parse(cred.transports) : ['internal']
    }));

    // PublicKeyCredentialCreationOptions
    const options = {
      challenge: challengeBase64,
      rp: {
        name: RP_NAME,
        id: RP_ID
      },
      user: {
        id: Buffer.from(user.id.toString()).toString('base64url'),
        name: username,
        displayName: user.employee?.name || username
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' }  // RS256
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // 平台驗證器（Face ID / 指紋）
        userVerification: 'required',
        residentKey: 'preferred'
      },
      excludeCredentials
    };

    // 儲存 challenge 到 session（簡化版：使用 cookie）
    const response = NextResponse.json({ options });
    response.cookies.set('webauthn_challenge', challengeBase64, {
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
