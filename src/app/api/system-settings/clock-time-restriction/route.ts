import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';
import { safeParseJSON } from '@/lib/validation';

const DEFAULT_SETTINGS = {
  enabled: true,
  restrictedStartHour: 23,    // 限制開始時間（23:00）
  restrictedEndHour: 5,       // 限制結束時間（05:00）
  message: '夜間時段暫停打卡服務'
};

function parseHourValue(
  value: unknown,
  label: '開始時間' | '結束時間'
): { value?: number; error?: string } {
  if (value === undefined) {
    return {};
  }

  let parsedValue: number;

  if (typeof value === 'number' && Number.isInteger(value)) {
    parsedValue = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    parsedValue = Number(value.trim());
  } else {
    return { error: `${label}需在 0-23 之間` };
  }

  if (parsedValue < 0 || parsedValue > 23) {
    return { error: `${label}需在 0-23 之間` };
  }

  return { value: parsedValue };
}

async function verifyAdmin(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== 'ADMIN') {
    return null;
  }

  return user;
}

// GET - 取得打卡時間限制設定
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const settings = await prisma.systemSettings.findUnique({
      where: { key: 'clock_time_restriction' }
    });

    if (settings) {
      return NextResponse.json({
        success: true,
        settings: safeParseSystemSettingsValue(settings.value, DEFAULT_SETTINGS, 'clock_time_restriction')
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

    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);

    if (!parsedBody.success) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const body = parsedBody.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { enabled, restrictedStartHour, restrictedEndHour, message } = body;

    const startHourResult = parseHourValue(restrictedStartHour, '開始時間');
    if (startHourResult.error) {
      return NextResponse.json({ error: startHourResult.error }, { status: 400 });
    }

    const endHourResult = parseHourValue(restrictedEndHour, '結束時間');
    if (endHourResult.error) {
      return NextResponse.json({ error: endHourResult.error }, { status: 400 });
    }

    const existingSettings = await prisma.systemSettings.findUnique({
      where: { key: 'clock_time_restriction' }
    });
    const baseSettings = safeParseSystemSettingsValue(
      existingSettings?.value,
      DEFAULT_SETTINGS,
      'clock_time_restriction'
    );

    const newSettings = {
      enabled: enabled ?? baseSettings.enabled,
      restrictedStartHour: startHourResult.value ?? baseSettings.restrictedStartHour,
      restrictedEndHour: endHourResult.value ?? baseSettings.restrictedEndHour,
      message: message ?? baseSettings.message
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
