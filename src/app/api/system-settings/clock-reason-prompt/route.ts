import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import {
  ClockReasonPromptSettings,
  DEFAULT_CLOCK_REASON_PROMPT_SETTINGS,
  normalizeClockReasonPromptSettings,
  parseClockReasonPromptSettings,
} from '@/lib/clock-reason-prompt-settings';

function parseThresholdValue(
  value: unknown,
  label: '提早上班閾值' | '延後下班閾值'
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
    return { error: `${label}需在 1-120 分鐘之間` };
  }

  if (parsedValue < 1 || parsedValue > 120) {
    return { error: `${label}需在 1-120 分鐘之間` };
  }

  return { value: parsedValue };
}

function parseBooleanValue(
  value: unknown,
  label: '啟用狀態' | '是否排除假日' | '是否排除核准加班'
): { value?: boolean; error?: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'boolean') {
    return { error: `${label}必須為布林值` };
  }

  return { value };
}

// GET - 取得設定
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const setting = await prisma.systemSettings.findUnique({
      where: { key: 'clock_reason_prompt' }
    });

    return NextResponse.json({
      success: true,
      settings: normalizeClockReasonPromptSettings(
        setting ? parseClockReasonPromptSettings(setting.value) : DEFAULT_CLOCK_REASON_PROMPT_SETTINGS
      ),
    });
  } catch (error) {
    console.error('取得打卡原因提示設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT - 更新設定
export async function PUT(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
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

    const earlyThresholdResult = parseThresholdValue(
      bodyRecord.earlyClockInThreshold,
      '提早上班閾值'
    );
    if (earlyThresholdResult.error) {
      return NextResponse.json({ error: earlyThresholdResult.error }, { status: 400 });
    }

    const lateThresholdResult = parseThresholdValue(
      bodyRecord.lateClockOutThreshold,
      '延後下班閾值'
    );
    if (lateThresholdResult.error) {
      return NextResponse.json({ error: lateThresholdResult.error }, { status: 400 });
    }

    const enabledResult = parseBooleanValue(bodyRecord.enabled, '啟用狀態');
    if (enabledResult.error) {
      return NextResponse.json({ error: enabledResult.error }, { status: 400 });
    }

    const excludeHolidaysResult = parseBooleanValue(bodyRecord.excludeHolidays, '是否排除假日');
    if (excludeHolidaysResult.error) {
      return NextResponse.json({ error: excludeHolidaysResult.error }, { status: 400 });
    }

    const excludeApprovedOvertimeResult = parseBooleanValue(
      bodyRecord.excludeApprovedOvertime,
      '是否排除核准加班'
    );
    if (excludeApprovedOvertimeResult.error) {
      return NextResponse.json({ error: excludeApprovedOvertimeResult.error }, { status: 400 });
    }

    const existingSetting = await prisma.systemSettings.findUnique({
      where: { key: 'clock_reason_prompt' }
    });
    const baseSettings = parseClockReasonPromptSettings(existingSetting?.value);

    const settings: ClockReasonPromptSettings = {
      enabled: enabledResult.value ?? baseSettings.enabled,
      earlyClockInThreshold: earlyThresholdResult.value ?? baseSettings.earlyClockInThreshold,
      lateClockOutThreshold: lateThresholdResult.value ?? baseSettings.lateClockOutThreshold,
      excludeHolidays: excludeHolidaysResult.value ?? baseSettings.excludeHolidays,
      excludeApprovedOvertime: excludeApprovedOvertimeResult.value ?? baseSettings.excludeApprovedOvertime
    };

    // 驗證閾值
    if (settings.earlyClockInThreshold < 1 || settings.earlyClockInThreshold > 120) {
      return NextResponse.json({ error: '提早上班閾值需在 1-120 分鐘之間' }, { status: 400 });
    }
    if (settings.lateClockOutThreshold < 1 || settings.lateClockOutThreshold > 120) {
      return NextResponse.json({ error: '延後下班閾值需在 1-120 分鐘之間' }, { status: 400 });
    }

    await prisma.systemSettings.upsert({
      where: { key: 'clock_reason_prompt' },
      update: { value: JSON.stringify(settings) },
      create: { key: 'clock_reason_prompt', value: JSON.stringify(settings) }
    });

    return NextResponse.json({ success: true, settings, message: '設定已儲存' });
  } catch (error) {
    console.error('更新打卡原因提示設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
