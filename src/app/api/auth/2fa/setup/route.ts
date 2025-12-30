/**
 * 2FA 設定 API
 * POST - 開始設定 2FA（產生密鑰和 QR Code）
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { generateTOTPSecret, generateQRCode, generateBackupCodes } from '@/lib/totp';
import { encrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    
    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: '無效的 Token' }, { status: 401 });
    }

    // 只允許 ADMIN 和 HR 設定 2FA
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '只有管理員和 HR 可以設定雙因素驗證' }, { status: 403 });
    }

    // 取得用戶資料
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { employee: true }
    });

    if (!dbUser) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    // 產生新的 TOTP 密鑰
    const secret = generateTOTPSecret();
    
    // 產生 QR Code
    const qrCodeDataUrl = await generateQRCode(secret, dbUser.username);
    
    // 產生備用碼
    const backupCodes = generateBackupCodes(8);

    // 將密鑰暫存到資料庫（尚未啟用）
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        twoFactorSecret: encrypt(secret),
        backupCodes: JSON.stringify(backupCodes.map(code => encrypt(code))),
        // 保持 twoFactorEnabled 為 false，直到用戶驗證成功
      }
    });

    console.log(`✅ [2FA] 用戶 ${dbUser.username} 開始設定 2FA`);

    return NextResponse.json({
      success: true,
      qrCode: qrCodeDataUrl,
      secret: secret, // 顯示密鑰供手動輸入
      backupCodes: backupCodes, // 顯示備用碼供用戶備份
      message: '請使用 Google Authenticator 或其他驗證器 APP 掃描 QR Code'
    });

  } catch (error) {
    console.error('2FA 設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
