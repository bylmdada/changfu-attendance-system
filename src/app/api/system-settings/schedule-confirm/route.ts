import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeParseJSON } from '@/lib/validation';
import { logSystemSettingsChange } from '@/lib/system-settings-audit';

/**
 * 班表確認機制設定 API
 * 
 * 設定 keys:
 * - scheduleConfirm.enabled: 是否啟用班表確認機制 (default: false)
 * - scheduleConfirm.blockClock: 未確認是否阻止打卡 (default: false)
 * - scheduleConfirm.enableReminder: 是否啟用提醒功能 (default: false)
 */

const SETTING_KEYS = {
  ENABLED: 'scheduleConfirm.enabled',
  BLOCK_CLOCK: 'scheduleConfirm.blockClock',
  ENABLE_REMINDER: 'scheduleConfirm.enableReminder'
};

const DEFAULT_SETTINGS: Record<string, boolean> = {
  [SETTING_KEYS.ENABLED]: false,
  [SETTING_KEYS.BLOCK_CLOCK]: false,
  [SETTING_KEYS.ENABLE_REMINDER]: false
};

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/schedule-confirm');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員可以查看設定
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const settings = await prisma.systemSettings.findMany({
      where: {
        key: { in: Object.values(SETTING_KEYS) }
      }
    });

    const result: Record<string, boolean> = { ...DEFAULT_SETTINGS };
    
    settings.forEach(s => {
      try {
        result[s.key] = JSON.parse(s.value);
      } catch {
        result[s.key] = DEFAULT_SETTINGS[s.key] ?? false;
      }
    });

    return NextResponse.json({
      success: true,
      settings: {
        enabled: result[SETTING_KEYS.ENABLED],
        blockClock: result[SETTING_KEYS.BLOCK_CLOCK],
        enableReminder: result[SETTING_KEYS.ENABLE_REMINDER]
      }
    });

  } catch (error) {
    console.error('取得班表確認設定錯誤:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/schedule-confirm');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員可以修改設定
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { enabled, blockClock, enableReminder } = body;

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return NextResponse.json({ error: '啟用狀態必須是布林值' }, { status: 400 });
    }

    if (blockClock !== undefined && typeof blockClock !== 'boolean') {
      return NextResponse.json({ error: '阻止打卡設定必須是布林值' }, { status: 400 });
    }

    if (enableReminder !== undefined && typeof enableReminder !== 'boolean') {
      return NextResponse.json({ error: '提醒功能設定必須是布林值' }, { status: 400 });
    }

    const existingRecords = await prisma.systemSettings.findMany({
      where: {
        key: { in: Object.values(SETTING_KEYS) }
      }
    });
    const oldSettings: Record<string, boolean> = { ...DEFAULT_SETTINGS };
    existingRecords.forEach(s => {
      try {
        oldSettings[s.key] = JSON.parse(s.value);
      } catch {
        oldSettings[s.key] = DEFAULT_SETTINGS[s.key] ?? false;
      }
    });

    const requestedSettings = {
      enabled: typeof enabled === 'boolean' ? enabled : oldSettings[SETTING_KEYS.ENABLED],
      blockClock: typeof blockClock === 'boolean' ? blockClock : oldSettings[SETTING_KEYS.BLOCK_CLOCK],
      enableReminder: typeof enableReminder === 'boolean' ? enableReminder : oldSettings[SETTING_KEYS.ENABLE_REMINDER],
    };
    const newSettings = {
      ...requestedSettings,
      enableReminder: requestedSettings.blockClock ? true : requestedSettings.enableReminder,
    };

    await prisma.$transaction([
      prisma.systemSettings.upsert({
        where: { key: SETTING_KEYS.ENABLED },
        create: { key: SETTING_KEYS.ENABLED, value: JSON.stringify(newSettings.enabled), description: '班表確認機制開關' },
        update: { value: JSON.stringify(newSettings.enabled) }
      }),
      prisma.systemSettings.upsert({
        where: { key: SETTING_KEYS.BLOCK_CLOCK },
        create: { key: SETTING_KEYS.BLOCK_CLOCK, value: JSON.stringify(newSettings.blockClock), description: '未確認班表阻止打卡' },
        update: { value: JSON.stringify(newSettings.blockClock) }
      }),
      prisma.systemSettings.upsert({
        where: { key: SETTING_KEYS.ENABLE_REMINDER },
        create: { key: SETTING_KEYS.ENABLE_REMINDER, value: JSON.stringify(newSettings.enableReminder), description: '班表確認提醒功能' },
        update: { value: JSON.stringify(newSettings.enableReminder) }
      }),
    ]);

    await logSystemSettingsChange({
      request,
      user,
      settingKey: 'schedule-confirm',
      description: '班表確認設定變更',
      oldValue: {
        enabled: oldSettings[SETTING_KEYS.ENABLED],
        blockClock: oldSettings[SETTING_KEYS.BLOCK_CLOCK],
        enableReminder: oldSettings[SETTING_KEYS.ENABLE_REMINDER],
      },
      newValue: newSettings,
    });

    return NextResponse.json({
      success: true,
      message: '設定已儲存',
      settings: newSettings,
    });

  } catch (error) {
    console.error('儲存班表確認設定錯誤:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}
