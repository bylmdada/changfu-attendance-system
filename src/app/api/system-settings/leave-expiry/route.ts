import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';
import { safeParseJSON } from '@/lib/validation';

const DEFAULT_SETTINGS = {
  compLeaveExpiryMonths: 6,       // 補休 6 個月內使用
  annualLeaveCanExtend: true,     // 特休可展延
  expiryMode: 'NOTIFY_ONLY',      // NOTIFY_ONLY, AUTO_EXPIRE, AUTO_SETTLE, AUTO_EXTEND
  reminderDaysBefore: [30, 14, 7], // 到期前 30/14/7 天提醒
  enabled: true
};

const VALID_EXPIRY_MODES = ['NOTIFY_ONLY', 'AUTO_EXPIRE', 'AUTO_SETTLE', 'AUTO_EXTEND'] as const;

function isReminderDaysBeforeArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(
    (day) => Number.isInteger(day) && day >= 0 && day <= 365
  );
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

// GET - 取得假期到期設定
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
      where: { key: 'leave_expiry_settings' }
    });

    if (settings) {
      return NextResponse.json({
        success: true,
        settings: {
          ...DEFAULT_SETTINGS,
          ...safeParseSystemSettingsValue<Partial<typeof DEFAULT_SETTINGS>>(
            settings.value,
            {},
            'leave_expiry_settings'
          )
        }
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

    const authResult = await verifyAdmin(request);
    if (authResult.error) {
      return authResult.error;
    }

    const bodyResult = await safeParseJSON(request);
    if (!bodyResult.success) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const body = bodyResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { compLeaveExpiryMonths, annualLeaveCanExtend, expiryMode, reminderDaysBefore, enabled } = body;

    // 驗證
    if (
      compLeaveExpiryMonths !== undefined && (
        typeof compLeaveExpiryMonths !== 'number' ||
        !Number.isInteger(compLeaveExpiryMonths) ||
        compLeaveExpiryMonths < 1 ||
        compLeaveExpiryMonths > 24
      )
    ) {
      return NextResponse.json({ error: '補休有效期限需在 1-24 個月之間' }, { status: 400 });
    }

    if (annualLeaveCanExtend !== undefined && typeof annualLeaveCanExtend !== 'boolean') {
      return NextResponse.json({ error: 'annualLeaveCanExtend 必須為布林值' }, { status: 400 });
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled 必須為布林值' }, { status: 400 });
    }

    if (
      expiryMode !== undefined && (
        typeof expiryMode !== 'string' ||
        !VALID_EXPIRY_MODES.includes(expiryMode as (typeof VALID_EXPIRY_MODES)[number])
      )
    ) {
      return NextResponse.json({ error: '無效的到期處理模式' }, { status: 400 });
    }

    if (reminderDaysBefore !== undefined && !isReminderDaysBeforeArray(reminderDaysBefore)) {
      return NextResponse.json({ error: 'reminderDaysBefore 必須為 0 到 365 的整數陣列' }, { status: 400 });
    }

    const existingSettingsRecord = await prisma.systemSettings.findUnique({
      where: { key: 'leave_expiry_settings' }
    });
    const existingSettings = existingSettingsRecord
      ? {
          ...DEFAULT_SETTINGS,
          ...safeParseSystemSettingsValue<Partial<typeof DEFAULT_SETTINGS>>(
            existingSettingsRecord.value,
            {},
            'leave_expiry_settings'
          )
        }
      : DEFAULT_SETTINGS;

    const newSettings = {
      compLeaveExpiryMonths: compLeaveExpiryMonths ?? existingSettings.compLeaveExpiryMonths,
      annualLeaveCanExtend: annualLeaveCanExtend ?? existingSettings.annualLeaveCanExtend,
      expiryMode: expiryMode ?? existingSettings.expiryMode,
      reminderDaysBefore: reminderDaysBefore ?? existingSettings.reminderDaysBefore,
      enabled: enabled ?? existingSettings.enabled
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
