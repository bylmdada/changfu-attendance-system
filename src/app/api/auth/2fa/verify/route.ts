/**
 * 2FA 驗證 API
 * POST - 驗證 TOTP 碼並啟用 2FA
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { verifyTOTP } from '@/lib/totp';
import { decrypt } from '@/lib/encryption';
import { validateCSRF } from '@/lib/csrf';

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    
    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: '無效的 Token' }, { status: 401 });
    }

    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string' || code.length !== 6) {
      return NextResponse.json({ error: '請輸入 6 位數驗證碼' }, { status: 400 });
    }

    // 取得用戶資料
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId }
    });

    if (!dbUser || !dbUser.twoFactorSecret) {
      return NextResponse.json({ error: '尚未設定 2FA' }, { status: 400 });
    }

    // 解密密鑰
    const secret = decrypt(dbUser.twoFactorSecret);
    
    // 驗證 TOTP 碼
    const isValid = verifyTOTP(code, secret);
    
    if (!isValid) {
      console.log(`❌ [2FA] 用戶 ${dbUser.username} 驗證碼錯誤`);
      return NextResponse.json({ error: '驗證碼錯誤，請重試' }, { status: 400 });
    }

    // 啟用 2FA
    await prisma.user.update({
      where: { id: user.userId },
      data: { twoFactorEnabled: true }
    });

    console.log(`✅ [2FA] 用戶 ${dbUser.username} 已啟用 2FA`);

    return NextResponse.json({
      success: true,
      message: '雙因素驗證已成功啟用'
    });

  } catch (error) {
    console.error('2FA 驗證失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
