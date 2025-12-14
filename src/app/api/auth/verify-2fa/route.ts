import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { authenticator } from 'otplib';

// POST - 驗證 2FA 驗證碼（登入時使用）
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const { userId, code } = body;

    if (!userId || !code) {
      return NextResponse.json({ error: '請提供使用者 ID 和驗證碼' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        backupCodes: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: '使用者不存在' }, { status: 404 });
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return NextResponse.json({ error: '2FA 尚未啟用' }, { status: 400 });
    }

    // 驗證 TOTP
    let isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret
    });

    // 檢查備用碼
    if (!isValid && user.backupCodes) {
      const backupCodes = JSON.parse(user.backupCodes) as string[];
      const codeIndex = backupCodes.indexOf(code.toUpperCase());
      
      if (codeIndex !== -1) {
        isValid = true;
        // 移除已使用的備用碼
        backupCodes.splice(codeIndex, 1);
        await prisma.user.update({
          where: { id: user.id },
          data: { backupCodes: JSON.stringify(backupCodes) }
        });
      }
    }

    if (!isValid) {
      return NextResponse.json({ 
        success: false, 
        error: '驗證碼錯誤' 
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: '2FA 驗證成功'
    });
  } catch (error) {
    console.error('2FA 驗證失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
