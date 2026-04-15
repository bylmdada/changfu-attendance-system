/**
 * 2FA 停用 API
 * POST - 停用雙因素驗證
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import bcrypt from 'bcryptjs';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const password = isPlainObject(body) && typeof body.password === 'string' ? body.password : '';

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
