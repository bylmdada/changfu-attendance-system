import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import crypto from 'crypto';

const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';

export async function POST(request: Request) {
  try {
    const { username } = await request.json();

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
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    if (user.webauthnCredentials.length === 0) {
      return NextResponse.json({ 
        error: '尚未設定 Face ID / 指紋',
        hasCredentials: false 
      }, { status: 400 });
    }

    // 生成 challenge
    const challenge = crypto.randomBytes(32);
    const challengeBase64 = challenge.toString('base64url');

    // 允許的憑證
    const allowCredentials = user.webauthnCredentials.map(cred => ({
      id: cred.credentialId,
      type: 'public-key' as const,
      transports: cred.transports ? JSON.parse(cred.transports) : ['internal']
    }));

    // PublicKeyCredentialRequestOptions
    const options = {
      challenge: challengeBase64,
      rpId: RP_ID,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials
    };

    // 儲存 challenge 和 username
    const response = NextResponse.json({ 
      options,
      hasCredentials: true 
    });
    response.cookies.set('webauthn_auth_challenge', challengeBase64, {
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
