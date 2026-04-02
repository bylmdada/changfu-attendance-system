import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

const DEFAULT_SETTINGS = {
  monthlyLimit: 46,           // 勞基法每月上限 46 小時
  warningThreshold: 36,       // 達到 36 小時發警告
  exceedMode: 'BLOCK',        // BLOCK: 禁止申請, FORCE_REVIEW: 強制審核
  enabled: true
};

// GET - 取得加班上限設定
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
      where: { key: 'overtime_limit_settings' }
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
    console.error('取得加班上限設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 更新加班上限設定
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
    const { monthlyLimit, warningThreshold, exceedMode, enabled } = body;

    // 驗證
    if (monthlyLimit !== undefined && (monthlyLimit < 0 || monthlyLimit > 100)) {
      return NextResponse.json({ error: '月加班上限需在 0-100 小時之間' }, { status: 400 });
    }

    if (warningThreshold !== undefined && (warningThreshold < 0 || warningThreshold > monthlyLimit)) {
      return NextResponse.json({ error: '警告門檻需小於月加班上限' }, { status: 400 });
    }

    if (exceedMode !== undefined && !['BLOCK', 'FORCE_REVIEW'].includes(exceedMode)) {
      return NextResponse.json({ error: '無效的超限處理模式' }, { status: 400 });
    }

    const newSettings = {
      monthlyLimit: monthlyLimit ?? DEFAULT_SETTINGS.monthlyLimit,
      warningThreshold: warningThreshold ?? DEFAULT_SETTINGS.warningThreshold,
      exceedMode: exceedMode ?? DEFAULT_SETTINGS.exceedMode,
      enabled: enabled ?? DEFAULT_SETTINGS.enabled
    };

    await prisma.systemSettings.upsert({
      where: { key: 'overtime_limit_settings' },
      update: { value: JSON.stringify(newSettings) },
      create: {
        key: 'overtime_limit_settings',
        value: JSON.stringify(newSettings),
        description: '加班時數上限設定'
      }
    });

    return NextResponse.json({
      success: true,
      message: '加班上限設定已更新',
      settings: newSettings
    });
  } catch (error) {
    console.error('更新加班上限設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
