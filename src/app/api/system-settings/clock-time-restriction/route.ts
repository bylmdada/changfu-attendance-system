import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import {
  DEFAULT_CLOCK_TIME_RESTRICTION_SETTINGS,
  parseClockTimeRestrictionSettings,
  type ClockTimeRestrictionSettings,
} from '@/lib/clock-time-restriction-settings';

const DEFAULT_SETTINGS = DEFAULT_CLOCK_TIME_RESTRICTION_SETTINGS;

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
  if (!user) {
    return {
      error: NextResponse.json({ error: '未授權訪問' }, { status: 401 }),
    };
  }

  if (user.role !== 'ADMIN') {
    return {
      error: NextResponse.json({ error: '需要管理員權限' }, { status: 403 }),
    };
  }

  return { user };
}

function parseEnabledValue(value: unknown): { value?: boolean; error?: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'boolean') {
    return { error: '啟用狀態必須為布林值' };
  }

  return { value };
}

function parseMessageValue(value: unknown): { value?: string; error?: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return { error: '提示訊息必須為非空字串' };
  }

  return { value: value.trim() };
}

// GET - 取得打卡時間限制設定
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const authResult = await verifyAdmin(request);
    if (authResult.error) {
      return authResult.error;
    }

    const settings = await prisma.systemSettings.findUnique({
      where: { key: 'clock_time_restriction' }
    });

    if (settings) {
      return NextResponse.json({
        success: true,
        settings: parseClockTimeRestrictionSettings(settings.value)
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

    const authResult = await verifyAdmin(request);
    if (authResult.error) {
      return authResult.error;
    }

    const parsedBody = await safeParseJSON(request);

    if (!parsedBody.success) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const body = parsedBody.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const bodyRecord = body as Record<string, unknown>;

    const enabledResult = parseEnabledValue(bodyRecord.enabled);
    if (enabledResult.error) {
      return NextResponse.json({ error: enabledResult.error }, { status: 400 });
    }

    const startHourResult = parseHourValue(bodyRecord.restrictedStartHour, '開始時間');
    if (startHourResult.error) {
      return NextResponse.json({ error: startHourResult.error }, { status: 400 });
    }

    const endHourResult = parseHourValue(bodyRecord.restrictedEndHour, '結束時間');
    if (endHourResult.error) {
      return NextResponse.json({ error: endHourResult.error }, { status: 400 });
    }

    const messageResult = parseMessageValue(bodyRecord.message);
    if (messageResult.error) {
      return NextResponse.json({ error: messageResult.error }, { status: 400 });
    }

    const existingSettings = await prisma.systemSettings.findUnique({
      where: { key: 'clock_time_restriction' }
    });
    const baseSettings = parseClockTimeRestrictionSettings(existingSettings?.value);

    const newSettings: ClockTimeRestrictionSettings = {
      enabled: enabledResult.value ?? baseSettings.enabled,
      restrictedStartHour: startHourResult.value ?? baseSettings.restrictedStartHour,
      restrictedEndHour: endHourResult.value ?? baseSettings.restrictedEndHour,
      message: messageResult.value ?? baseSettings.message
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
