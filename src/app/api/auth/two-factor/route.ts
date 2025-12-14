import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

// GET - 取得 2FA 狀態或產生設定 QR Code
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的 Token' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        role: true,
        twoFactorEnabled: true,
        employee: {
          select: { name: true }
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: '使用者不存在' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // 產生新的 2FA 設定
    if (action === 'setup') {
      if (user.twoFactorEnabled) {
        return NextResponse.json({ 
          error: '2FA 已啟用，請先停用後再重新設定' 
        }, { status: 400 });
      }

      // 產生新的密鑰
      const secret = authenticator.generateSecret();
      const appName = '長福考勤系統';
      const accountName = user.employee?.name || user.username;
      
      // 產生 TOTP URI
      const otpauth = authenticator.keyuri(accountName, appName, secret);
      
      // 產生 QR Code（base64）
      const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

      // 暫存密鑰到資料庫（尚未啟用）
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: secret }
      });

      return NextResponse.json({
        success: true,
        setup: {
          secret,
          qrCode: qrCodeDataUrl,
          accountName,
          appName
        }
      });
    }

    // 返回 2FA 狀態
    return NextResponse.json({
      success: true,
      twoFactor: {
        enabled: user.twoFactorEnabled,
        isAdmin: user.role === 'ADMIN'
      }
    });
  } catch (error) {
    console.error('取得 2FA 狀態失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 驗證並啟用 2FA / 停用 2FA
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的 Token' }, { status: 401 });
    }

    const body = await request.json();
    const { action, code } = body;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return NextResponse.json({ error: '使用者不存在' }, { status: 404 });
    }

    // 啟用 2FA
    if (action === 'enable') {
      if (!user.twoFactorSecret) {
        return NextResponse.json({ 
          error: '請先產生 2FA 設定' 
        }, { status: 400 });
      }

      if (!code) {
        return NextResponse.json({ error: '請輸入驗證碼' }, { status: 400 });
      }

      // 驗證 TOTP
      const isValid = authenticator.verify({
        token: code,
        secret: user.twoFactorSecret
      });

      if (!isValid) {
        return NextResponse.json({ error: '驗證碼錯誤' }, { status: 400 });
      }

      // 產生備用碼
      const backupCodes = Array.from({ length: 8 }, () => 
        Math.random().toString(36).substring(2, 10).toUpperCase()
      );

      // 啟用 2FA
      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true,
          backupCodes: JSON.stringify(backupCodes)
        }
      });

      return NextResponse.json({
        success: true,
        message: '2FA 已啟用',
        backupCodes
      });
    }

    // 停用 2FA
    if (action === 'disable') {
      if (!user.twoFactorEnabled) {
        return NextResponse.json({ error: '2FA 尚未啟用' }, { status: 400 });
      }

      if (!code) {
        return NextResponse.json({ error: '請輸入驗證碼' }, { status: 400 });
      }

      // 驗證 TOTP 或備用碼
      let isValid = false;
      
      if (user.twoFactorSecret) {
        isValid = authenticator.verify({
          token: code,
          secret: user.twoFactorSecret
        });
      }

      // 檢查備用碼
      if (!isValid && user.backupCodes) {
        const backupCodes = JSON.parse(user.backupCodes) as string[];
        if (backupCodes.includes(code.toUpperCase())) {
          isValid = true;
        }
      }

      if (!isValid) {
        return NextResponse.json({ error: '驗證碼錯誤' }, { status: 400 });
      }

      // 停用 2FA
      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          backupCodes: null
        }
      });

      return NextResponse.json({
        success: true,
        message: '2FA 已停用'
      });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    console.error('2FA 操作失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
