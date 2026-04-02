/**
 * 2FA 停用 API
 * POST - 停用雙因素驗證
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import bcrypt from 'bcryptjs';

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
    
    const user = await getUserFromToken(token);
    if (!user) {
      return NextResponse.json({ error: '無效的 Token' }, { status: 401 });
    }

    const body = await request.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json({ error: '請輸入密碼確認' }, { status: 400 });
    }

    // 取得用戶資料
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId }
    });

    if (!dbUser) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    // 驗證密碼
    const isPasswordValid = await bcrypt.compare(password, dbUser.passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json({ error: '密碼錯誤' }, { status: 400 });
    }

    // 停用 2FA
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        backupCodes: null
      }
    });

    console.log(`⚠️ [2FA] 用戶 ${dbUser.username} 已停用 2FA`);

    return NextResponse.json({
      success: true,
      message: '雙因素驗證已停用'
    });

  } catch (error) {
    console.error('停用 2FA 失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
