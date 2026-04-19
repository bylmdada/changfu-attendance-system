import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import {
  normalizeSupplementaryPremiumSettings,
  SUPPLEMENTARY_PREMIUM_SETTINGS_KEY,
  type SupplementaryPremiumSettings,
} from '@/lib/supplementary-premium-config';
import { getStoredSupplementaryPremiumSettings } from '@/lib/supplementary-premium-settings';

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

    const settings = await getStoredSupplementaryPremiumSettings();

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

    const existingSettings = await getStoredSupplementaryPremiumSettings();
    const settings = normalizeSupplementaryPremiumSettings({
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
      where: { key: SUPPLEMENTARY_PREMIUM_SETTINGS_KEY },
      create: {
        key: SUPPLEMENTARY_PREMIUM_SETTINGS_KEY,
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
