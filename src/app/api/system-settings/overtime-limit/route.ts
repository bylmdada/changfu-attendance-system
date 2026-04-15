import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';
import { safeParseJSON } from '@/lib/validation';

const DEFAULT_SETTINGS = {
  monthlyLimit: 46,           // 勞基法每月上限 46 小時
  warningThreshold: 36,       // 達到 36 小時發警告
  exceedMode: 'BLOCK',        // BLOCK: 禁止申請, FORCE_REVIEW: 強制審核
  enabled: true
};

function parseOptionalLimitValue(
  value: unknown,
  field: 'monthlyLimit' | 'warningThreshold'
): { value?: number; error?: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      error: field === 'monthlyLimit'
        ? '月加班上限需在 0-100 小時之間'
        : '警告門檻需小於月加班上限'
    };
  }

  return { value };
}

function parseOptionalBooleanValue(value: unknown): { value?: boolean; error?: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'boolean') {
    return { error: '啟用狀態必須為布林值' };
  }

  return { value };
}

function parseOptionalExceedModeValue(
  value: unknown
): { value?: 'BLOCK' | 'FORCE_REVIEW'; error?: string } {
  if (value === undefined) {
    return {};
  }

  if (value !== 'BLOCK' && value !== 'FORCE_REVIEW') {
    return { error: '無效的超限處理模式' };
  }

  return { value };
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

// GET - 取得加班上限設定
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
      where: { key: 'overtime_limit_settings' }
    });

    if (settings) {
      return NextResponse.json({
        success: true,
        settings: safeParseSystemSettingsValue(settings.value, DEFAULT_SETTINGS, 'overtime_limit_settings')
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

    const bodyRecord = body as Record<string, unknown>;

    const monthlyLimitResult = parseOptionalLimitValue(bodyRecord.monthlyLimit, 'monthlyLimit');
    if (monthlyLimitResult.error) {
      return NextResponse.json({ error: monthlyLimitResult.error }, { status: 400 });
    }

    const warningThresholdResult = parseOptionalLimitValue(bodyRecord.warningThreshold, 'warningThreshold');
    if (warningThresholdResult.error) {
      return NextResponse.json({ error: warningThresholdResult.error }, { status: 400 });
    }

    const enabledResult = parseOptionalBooleanValue(bodyRecord.enabled);
    if (enabledResult.error) {
      return NextResponse.json({ error: enabledResult.error }, { status: 400 });
    }

    const exceedModeResult = parseOptionalExceedModeValue(bodyRecord.exceedMode);
    if (exceedModeResult.error) {
      return NextResponse.json({ error: exceedModeResult.error }, { status: 400 });
    }

    const existingSettings = await prisma.systemSettings.findUnique({
      where: { key: 'overtime_limit_settings' }
    });
    const baseSettings = safeParseSystemSettingsValue(
      existingSettings?.value,
      DEFAULT_SETTINGS,
      'overtime_limit_settings'
    );

    const effectiveMonthlyLimit = monthlyLimitResult.value ?? baseSettings.monthlyLimit;

    // 驗證
    if (monthlyLimitResult.value !== undefined && (monthlyLimitResult.value < 0 || monthlyLimitResult.value > 100)) {
      return NextResponse.json({ error: '月加班上限需在 0-100 小時之間' }, { status: 400 });
    }

    if (warningThresholdResult.value !== undefined && (warningThresholdResult.value < 0 || warningThresholdResult.value > effectiveMonthlyLimit)) {
      return NextResponse.json({ error: '警告門檻需小於月加班上限' }, { status: 400 });
    }

    const newSettings = {
      monthlyLimit: effectiveMonthlyLimit,
      warningThreshold: warningThresholdResult.value ?? baseSettings.warningThreshold,
      exceedMode: exceedModeResult.value ?? baseSettings.exceedMode,
      enabled: enabledResult.value ?? baseSettings.enabled
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
