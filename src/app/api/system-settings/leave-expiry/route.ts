import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

const DEFAULT_SETTINGS = {
  compLeaveExpiryMonths: 6,       // 補休 6 個月內使用
  annualLeaveCanExtend: true,     // 特休可展延
  expiryMode: 'NOTIFY_ONLY',      // NOTIFY_ONLY, AUTO_EXPIRE, AUTO_SETTLE, AUTO_EXTEND
  reminderDaysBefore: [30, 14, 7], // 到期前 30/14/7 天提醒
  enabled: true
};

// GET - 取得假期到期設定
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

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const settings = await prisma.systemSettings.findUnique({
      where: { key: 'leave_expiry_settings' }
    });

    if (settings) {
      return NextResponse.json({
        success: true,
        settings: JSON.parse(settings.value)
      });
    }

    return NextResponse.json({
      success: true,
      settings: DEFAULT_SETTINGS
    });
  } catch (error) {
    console.error('取得假期到期設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 更新假期到期設定
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

    const decoded = await getUserFromToken(token);
    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { compLeaveExpiryMonths, annualLeaveCanExtend, expiryMode, reminderDaysBefore, enabled } = body;

    // 驗證
    if (compLeaveExpiryMonths !== undefined && (compLeaveExpiryMonths < 1 || compLeaveExpiryMonths > 24)) {
      return NextResponse.json({ error: '補休有效期限需在 1-24 個月之間' }, { status: 400 });
    }

    const validModes = ['NOTIFY_ONLY', 'AUTO_EXPIRE', 'AUTO_SETTLE', 'AUTO_EXTEND'];
    if (expiryMode !== undefined && !validModes.includes(expiryMode)) {
      return NextResponse.json({ error: '無效的到期處理模式' }, { status: 400 });
    }

    const newSettings = {
      compLeaveExpiryMonths: compLeaveExpiryMonths ?? DEFAULT_SETTINGS.compLeaveExpiryMonths,
      annualLeaveCanExtend: annualLeaveCanExtend ?? DEFAULT_SETTINGS.annualLeaveCanExtend,
      expiryMode: expiryMode ?? DEFAULT_SETTINGS.expiryMode,
      reminderDaysBefore: reminderDaysBefore ?? DEFAULT_SETTINGS.reminderDaysBefore,
      enabled: enabled ?? DEFAULT_SETTINGS.enabled
    };

    await prisma.systemSettings.upsert({
      where: { key: 'leave_expiry_settings' },
      update: { value: JSON.stringify(newSettings) },
      create: {
        key: 'leave_expiry_settings',
        value: JSON.stringify(newSettings),
        description: '假期到期設定'
      }
    });

    return NextResponse.json({
      success: true,
      message: '假期到期設定已更新',
      settings: newSettings
    });
  } catch (error) {
    console.error('更新假期到期設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
