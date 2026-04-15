import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';
import { safeParseJSON } from '@/lib/validation';

interface ProratedBonusSettings {
  isEnabled: boolean;
  calculationMethod: 'MONTHLY' | 'DAILY';
  cutoffDay: number;
  prorateForNewHires: boolean;
  prorateForTerminated: boolean;
  minimumServiceDays: number;
  yearEndBonusProration: boolean;
  festivalBonusProration: boolean;
}

const SETTINGS_KEY = 'prorated_bonus_settings';

const DEFAULT_SETTINGS: ProratedBonusSettings = {
  isEnabled: true,
  calculationMethod: 'MONTHLY',
  cutoffDay: 15,
  prorateForNewHires: true,
  prorateForTerminated: true,
  minimumServiceDays: 90,
  yearEndBonusProration: true,
  festivalBonusProration: true,
};

function getDefaultSettings(): ProratedBonusSettings {
  return { ...DEFAULT_SETTINGS };
}

async function getStoredSettings(): Promise<ProratedBonusSettings> {
  const setting = await prisma.systemSettings.findUnique({
    where: { key: SETTINGS_KEY },
  });

  if (!setting) {
    return getDefaultSettings();
  }

  return normalizeSettings(
    safeParseSystemSettingsValue<Partial<ProratedBonusSettings>>(setting.value, {}, SETTINGS_KEY)
  );
}

async function verifyAdmin(request: NextRequest) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: '未授權' }, { status: 401 });
  }

  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: '無權限' }, { status: 403 });
  }

  return null;
}

function normalizeSettings(input: Partial<ProratedBonusSettings>): ProratedBonusSettings {
  const defaults = getDefaultSettings();

  return {
    isEnabled: input.isEnabled ?? defaults.isEnabled,
    calculationMethod: input.calculationMethod ?? defaults.calculationMethod,
    cutoffDay: Number(input.cutoffDay ?? defaults.cutoffDay),
    prorateForNewHires: input.prorateForNewHires ?? defaults.prorateForNewHires,
    prorateForTerminated: input.prorateForTerminated ?? defaults.prorateForTerminated,
    minimumServiceDays: Number(input.minimumServiceDays ?? defaults.minimumServiceDays),
    yearEndBonusProration: input.yearEndBonusProration ?? defaults.yearEndBonusProration,
    festivalBonusProration: input.festivalBonusProration ?? defaults.festivalBonusProration,
  };
}

function parseOptionalBooleanValue(
  value: unknown,
  errorMessage: string
): { value?: boolean; error?: string } {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'boolean') {
    return { error: errorMessage };
  }

  return { value };
}

function parseOptionalCalculationMethodValue(
  value: unknown
): { value?: ProratedBonusSettings['calculationMethod']; error?: string } {
  if (value === undefined || value === null) {
    return {};
  }

  if (value !== 'MONTHLY' && value !== 'DAILY') {
    return { error: '按比例計算方式不正確' };
  }

  return { value };
}

function parseOptionalNumberValue(
  value: unknown,
  errorMessage: string
): { value?: number; error?: string } {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: errorMessage };
  }

  return { value };
}

function validateSettings(settings: ProratedBonusSettings) {
  if (!['MONTHLY', 'DAILY'].includes(settings.calculationMethod)) {
    return '按比例計算方式不正確';
  }

  if (Number.isNaN(settings.cutoffDay) || settings.cutoffDay < 1 || settings.cutoffDay > 31) {
    return '結算日必須介於 1 到 31 之間';
  }

  if (Number.isNaN(settings.minimumServiceDays) || settings.minimumServiceDays < 0) {
    return '最低在職天數不可為負數';
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const authError = await verifyAdmin(request);
    if (authError) {
      return authError;
    }

    const settings = await getStoredSettings();

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('取得按比例獎金設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/prorated-bonus');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '按比例獎金設定操作過於頻繁，請稍後再試' },
        { status: 429 }
      );
    }

    const authError = await verifyAdmin(request);
    if (authError) {
      return authError;
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const bodyResult = await safeParseJSON(request);
    if (!bodyResult.success) {
      return NextResponse.json(
        {
          error: bodyResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式',
        },
        { status: 400 }
      );
    }

    const body = bodyResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const bodyRecord = body as Record<string, unknown>;

    const isEnabledResult = parseOptionalBooleanValue(bodyRecord.isEnabled, '啟用狀態必須為布林值');
    if (isEnabledResult.error) {
      return NextResponse.json({ error: isEnabledResult.error }, { status: 400 });
    }

    const calculationMethodResult = parseOptionalCalculationMethodValue(bodyRecord.calculationMethod);
    if (calculationMethodResult.error) {
      return NextResponse.json({ error: calculationMethodResult.error }, { status: 400 });
    }

    const cutoffDayResult = parseOptionalNumberValue(bodyRecord.cutoffDay, '結算日必須介於 1 到 31 之間');
    if (cutoffDayResult.error) {
      return NextResponse.json({ error: cutoffDayResult.error }, { status: 400 });
    }

    if (
      cutoffDayResult.value !== undefined &&
      (cutoffDayResult.value < 1 || cutoffDayResult.value > 31)
    ) {
      return NextResponse.json({ error: '結算日必須介於 1 到 31 之間' }, { status: 400 });
    }

    const prorateForNewHiresResult = parseOptionalBooleanValue(
      bodyRecord.prorateForNewHires,
      '新進員工按比例計算設定必須為布林值'
    );
    if (prorateForNewHiresResult.error) {
      return NextResponse.json({ error: prorateForNewHiresResult.error }, { status: 400 });
    }

    const prorateForTerminatedResult = parseOptionalBooleanValue(
      bodyRecord.prorateForTerminated,
      '離職員工按比例計算設定必須為布林值'
    );
    if (prorateForTerminatedResult.error) {
      return NextResponse.json({ error: prorateForTerminatedResult.error }, { status: 400 });
    }

    const minimumServiceDaysResult = parseOptionalNumberValue(
      bodyRecord.minimumServiceDays,
      '最低在職天數不可為負數'
    );
    if (minimumServiceDaysResult.error) {
      return NextResponse.json({ error: minimumServiceDaysResult.error }, { status: 400 });
    }

    if (minimumServiceDaysResult.value !== undefined && minimumServiceDaysResult.value < 0) {
      return NextResponse.json({ error: '最低在職天數不可為負數' }, { status: 400 });
    }

    const yearEndBonusProrationResult = parseOptionalBooleanValue(
      bodyRecord.yearEndBonusProration,
      '年終獎金按比例計算設定必須為布林值'
    );
    if (yearEndBonusProrationResult.error) {
      return NextResponse.json({ error: yearEndBonusProrationResult.error }, { status: 400 });
    }

    const festivalBonusProrationResult = parseOptionalBooleanValue(
      bodyRecord.festivalBonusProration,
      '節慶獎金按比例計算設定必須為布林值'
    );
    if (festivalBonusProrationResult.error) {
      return NextResponse.json({ error: festivalBonusProrationResult.error }, { status: 400 });
    }

    const existingSettings = await getStoredSettings();
    const settings = normalizeSettings({
      ...existingSettings,
      ...(isEnabledResult.value !== undefined ? { isEnabled: isEnabledResult.value } : {}),
      ...(calculationMethodResult.value !== undefined
        ? { calculationMethod: calculationMethodResult.value }
        : {}),
      ...(cutoffDayResult.value !== undefined ? { cutoffDay: cutoffDayResult.value } : {}),
      ...(prorateForNewHiresResult.value !== undefined
        ? { prorateForNewHires: prorateForNewHiresResult.value }
        : {}),
      ...(prorateForTerminatedResult.value !== undefined
        ? { prorateForTerminated: prorateForTerminatedResult.value }
        : {}),
      ...(minimumServiceDaysResult.value !== undefined
        ? { minimumServiceDays: minimumServiceDaysResult.value }
        : {}),
      ...(yearEndBonusProrationResult.value !== undefined
        ? { yearEndBonusProration: yearEndBonusProrationResult.value }
        : {}),
      ...(festivalBonusProrationResult.value !== undefined
        ? { festivalBonusProration: festivalBonusProrationResult.value }
        : {}),
    });
    const validationError = validateSettings(settings);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    await prisma.systemSettings.upsert({
      where: { key: SETTINGS_KEY },
      create: {
        key: SETTINGS_KEY,
        value: JSON.stringify(settings),
        description: '獎金按比例計算設定',
      },
      update: {
        value: JSON.stringify(settings),
        description: '獎金按比例計算設定',
      },
    });

    return NextResponse.json({
      success: true,
      settings,
      message: '獎金按比例計算設定已更新',
    });
  } catch (error) {
    console.error('儲存按比例獎金設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}