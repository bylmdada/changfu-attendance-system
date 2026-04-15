import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

interface SupplementaryPremiumSettings {
  isEnabled: boolean;
  premiumRate: number;
  exemptThresholdMultiplier: number;
  minimumThreshold: number;
  maxMonthlyPremium: number;
  exemptionThreshold: number;
  annualMaxDeduction: number;
  salaryThreshold: number;
  dividendThreshold: number;
  salaryIncludeItems: {
    overtime: boolean;
    bonus: boolean;
    allowance: boolean;
    commission: boolean;
  };
  calculationMethod: 'CUMULATIVE' | 'MONTHLY';
  resetPeriod: 'YEARLY' | 'MONTHLY';
  applyToAllEmployees: boolean;
  description: string;
}

const SETTINGS_KEY = 'supplementary_premium_settings';

const DEFAULT_SETTINGS: SupplementaryPremiumSettings = {
  isEnabled: true,
  premiumRate: 2.11,
  exemptThresholdMultiplier: 4,
  minimumThreshold: 5000,
  maxMonthlyPremium: 1000000,
  exemptionThreshold: 20000,
  annualMaxDeduction: 1000000,
  salaryThreshold: 183200,
  dividendThreshold: 20000,
  salaryIncludeItems: {
    overtime: false,
    bonus: true,
    allowance: true,
    commission: true,
  },
  calculationMethod: 'CUMULATIVE',
  resetPeriod: 'YEARLY',
  applyToAllEmployees: true,
  description: '依據全民健康保險法規定之補充保費計算設定',
};

function getDefaultSettings(): SupplementaryPremiumSettings {
  return {
    ...DEFAULT_SETTINGS,
    salaryIncludeItems: {
      ...DEFAULT_SETTINGS.salaryIncludeItems,
    },
  };
}

async function getStoredSettings(): Promise<SupplementaryPremiumSettings> {
  const setting = await prisma.systemSettings.findUnique({
    where: { key: SETTINGS_KEY },
  });

  if (!setting) {
    return getDefaultSettings();
  }

  return normalizeSettings(
    safeParseSystemSettingsValue<Partial<SupplementaryPremiumSettings>>(setting.value, {}, SETTINGS_KEY)
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

function normalizeSettings(input: Partial<SupplementaryPremiumSettings>): SupplementaryPremiumSettings {
  const defaults = getDefaultSettings();

  return {
    isEnabled: input.isEnabled ?? defaults.isEnabled,
    premiumRate: Number(input.premiumRate ?? defaults.premiumRate),
    exemptThresholdMultiplier: Number(input.exemptThresholdMultiplier ?? defaults.exemptThresholdMultiplier),
    minimumThreshold: Number(input.minimumThreshold ?? defaults.minimumThreshold),
    maxMonthlyPremium: Number(input.maxMonthlyPremium ?? defaults.maxMonthlyPremium),
    exemptionThreshold: Number(input.exemptionThreshold ?? defaults.exemptionThreshold),
    annualMaxDeduction: Number(input.annualMaxDeduction ?? defaults.annualMaxDeduction),
    salaryThreshold: Number(input.salaryThreshold ?? defaults.salaryThreshold),
    dividendThreshold: Number(input.dividendThreshold ?? defaults.dividendThreshold),
    salaryIncludeItems: {
      overtime: input.salaryIncludeItems?.overtime ?? defaults.salaryIncludeItems.overtime,
      bonus: input.salaryIncludeItems?.bonus ?? defaults.salaryIncludeItems.bonus,
      allowance: input.salaryIncludeItems?.allowance ?? defaults.salaryIncludeItems.allowance,
      commission: input.salaryIncludeItems?.commission ?? defaults.salaryIncludeItems.commission,
    },
    calculationMethod: input.calculationMethod ?? defaults.calculationMethod,
    resetPeriod: input.resetPeriod ?? defaults.resetPeriod,
    applyToAllEmployees: input.applyToAllEmployees ?? defaults.applyToAllEmployees,
    description: input.description?.trim() || defaults.description,
  };
}

function validateSettings(settings: SupplementaryPremiumSettings) {
  const numericFields: Array<[string, number]> = [
    ['premiumRate', settings.premiumRate],
    ['exemptThresholdMultiplier', settings.exemptThresholdMultiplier],
    ['minimumThreshold', settings.minimumThreshold],
    ['maxMonthlyPremium', settings.maxMonthlyPremium],
    ['exemptionThreshold', settings.exemptionThreshold],
    ['annualMaxDeduction', settings.annualMaxDeduction],
    ['salaryThreshold', settings.salaryThreshold],
    ['dividendThreshold', settings.dividendThreshold],
  ];

  if (numericFields.some(([, value]) => Number.isNaN(value) || value < 0)) {
    return '設定數值不可為負數或無效';
  }

  if (settings.premiumRate <= 0 || settings.premiumRate > 100) {
    return '補充保費費率必須介於 0 到 100 之間';
  }

  if (!['CUMULATIVE', 'MONTHLY'].includes(settings.calculationMethod)) {
    return '補充保費計算方式不正確';
  }

  if (!['YEARLY', 'MONTHLY'].includes(settings.resetPeriod)) {
    return '補充保費重置週期不正確';
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
    console.error('取得補充保費設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/supplementary-premium');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '補充保費設定操作過於頻繁，請稍後再試' },
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

    const input = body as Partial<SupplementaryPremiumSettings> & {
      salaryIncludeItems?: Partial<SupplementaryPremiumSettings['salaryIncludeItems']>;
    };

    const existingSettings = await getStoredSettings();
    const settings = normalizeSettings({
      ...existingSettings,
      ...input,
      salaryIncludeItems: {
        ...existingSettings.salaryIncludeItems,
        ...(input.salaryIncludeItems ?? {}),
      },
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
        description: '補充保費計算設定',
      },
      update: {
        value: JSON.stringify(settings),
        description: '補充保費計算設定',
      },
    });

    return NextResponse.json({
      success: true,
      settings,
      message: '補充保費設定已更新',
    });
  } catch (error) {
    console.error('儲存補充保費設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}