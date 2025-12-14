import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

const DEFAULT_SETTINGS = {
  enabled: true,
  restrictedStartHour: 23,    // 限制開始時間（23:00）
  restrictedEndHour: 5,       // 限制結束時間（05:00）
  message: '夜間時段暫停打卡服務'
};

// GET - 取得打卡時間限制設定
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
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const settings = await prisma.systemSettings.findUnique({
      where: { key: 'clock_time_restriction' }
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
    console.error('取得打卡時間限制設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 更新打卡時間限制設定
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
    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { enabled, restrictedStartHour, restrictedEndHour, message } = body;

    // 驗證時間範圍
    if (restrictedStartHour !== undefined && (restrictedStartHour < 0 || restrictedStartHour > 23)) {
      return NextResponse.json({ error: '開始時間需在 0-23 之間' }, { status: 400 });
    }

    if (restrictedEndHour !== undefined && (restrictedEndHour < 0 || restrictedEndHour > 23)) {
      return NextResponse.json({ error: '結束時間需在 0-23 之間' }, { status: 400 });
    }

    const newSettings = {
      enabled: enabled ?? DEFAULT_SETTINGS.enabled,
      restrictedStartHour: restrictedStartHour ?? DEFAULT_SETTINGS.restrictedStartHour,
      restrictedEndHour: restrictedEndHour ?? DEFAULT_SETTINGS.restrictedEndHour,
      message: message ?? DEFAULT_SETTINGS.message
    };

    await prisma.systemSettings.upsert({
      where: { key: 'clock_time_restriction' },
      update: { value: JSON.stringify(newSettings) },
      create: {
        key: 'clock_time_restriction',
        value: JSON.stringify(newSettings),
        description: '打卡時間限制設定'
      }
    });

    return NextResponse.json({
      success: true,
      message: '打卡時間限制設定已更新',
      settings: newSettings
    });
  } catch (error) {
    console.error('更新打卡時間限制設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
