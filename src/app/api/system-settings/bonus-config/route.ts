/**
 * 獎金配置 API
 * GET: 取得獎金配置
 * POST: 儲存獎金配置
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

type BonusConfigPayload = {
  bonusTypeName?: string;
  eligibilityRules?: Record<string, unknown>;
  paymentSchedule?: Record<string, unknown>;
};

type StoredBonusConfig = {
  bonusTypeName: string;
  eligibilityRules: Record<string, unknown>;
  paymentSchedule: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBonusConfigField(
  rawValue: unknown,
  fallback: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  if (typeof rawValue === 'string') {
    return safeParseSystemSettingsValue(rawValue, fallback, key);
  }

  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue as Record<string, unknown>;
  }

  return fallback;
}

function normalizeStoredConfig(
  config: {
    bonusTypeName?: string | null;
    eligibilityRules?: unknown;
    paymentSchedule?: unknown;
  } | null,
  defaultName: string,
  bonusType: 'YEAR_END' | 'FESTIVAL'
): StoredBonusConfig {
  return {
    bonusTypeName: config?.bonusTypeName || defaultName,
    eligibilityRules: parseBonusConfigField(config?.eligibilityRules, {}, `${bonusType}.eligibilityRules`),
    paymentSchedule: parseBonusConfigField(config?.paymentSchedule, {}, `${bonusType}.paymentSchedule`),
  };
}

function validateIncomingConfig(
  config: unknown,
  label: string
): { value?: BonusConfigPayload; error?: string } {
  if (config === undefined) {
    return {};
  }

  if (!isPlainObject(config)) {
    return { error: `${label}設定格式無效` };
  }

  const { bonusTypeName, eligibilityRules, paymentSchedule } = config;

  if (bonusTypeName !== undefined && typeof bonusTypeName !== 'string') {
    return { error: `${label}名稱必須為字串` };
  }

  if (eligibilityRules !== undefined && !isPlainObject(eligibilityRules)) {
    return { error: `${label}資格規則格式無效` };
  }

  if (paymentSchedule !== undefined && !isPlainObject(paymentSchedule)) {
    return { error: `${label}發放排程格式無效` };
  }

  return {
    value: {
      bonusTypeName,
      eligibilityRules: eligibilityRules as Record<string, unknown> | undefined,
      paymentSchedule: paymentSchedule as Record<string, unknown> | undefined,
    },
  };
}

async function upsertBonusConfig(
  bonusType: 'YEAR_END' | 'FESTIVAL',
  defaultName: string,
  incomingConfig?: BonusConfigPayload
) {
  if (!incomingConfig) {
    return;
  }

  const existingConfig = normalizeStoredConfig(
    await prisma.bonusConfiguration.findUnique({ where: { bonusType } }),
    defaultName,
    bonusType
  );

  const mergedConfig: StoredBonusConfig = {
    bonusTypeName: incomingConfig.bonusTypeName ?? existingConfig.bonusTypeName,
    eligibilityRules: incomingConfig.eligibilityRules ?? existingConfig.eligibilityRules,
    paymentSchedule: incomingConfig.paymentSchedule ?? existingConfig.paymentSchedule,
  };

  await prisma.bonusConfiguration.upsert({
    where: { bonusType },
    update: {
      bonusTypeName: mergedConfig.bonusTypeName,
      eligibilityRules: JSON.stringify(mergedConfig.eligibilityRules),
      paymentSchedule: JSON.stringify(mergedConfig.paymentSchedule),
      isActive: true,
    },
    create: {
      bonusType,
      bonusTypeName: mergedConfig.bonusTypeName,
      eligibilityRules: JSON.stringify(mergedConfig.eligibilityRules),
      paymentSchedule: JSON.stringify(mergedConfig.paymentSchedule),
      isActive: true,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const configs = await prisma.bonusConfiguration.findMany({
      orderBy: { bonusType: 'asc' }
    });

    // 解析 JSON 欄位
    const parsedConfigs = configs.map(config => ({
      ...config,
      eligibilityRules: parseBonusConfigField(
        config.eligibilityRules,
        {},
        `${config.bonusType}.eligibilityRules`
      ),
      paymentSchedule: parseBonusConfigField(
        config.paymentSchedule,
        {},
        `${config.bonusType}.paymentSchedule`
      )
    }));

    return NextResponse.json({
      success: true,
      configs: parsedConfigs
    });

  } catch (error) {
    console.error('取得獎金配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const {
      yearEndConfig,
      festivalConfig,
    } = data as {
      yearEndConfig?: BonusConfigPayload;
      festivalConfig?: BonusConfigPayload;
    };

    const validatedYearEndConfig = validateIncomingConfig(yearEndConfig, '年終獎金');
    if (validatedYearEndConfig.error) {
      return NextResponse.json({ error: validatedYearEndConfig.error }, { status: 400 });
    }

    const validatedFestivalConfig = validateIncomingConfig(festivalConfig, '三節獎金');
    if (validatedFestivalConfig.error) {
      return NextResponse.json({ error: validatedFestivalConfig.error }, { status: 400 });
    }

    // 儲存年終獎金設定
    await upsertBonusConfig('YEAR_END', '年終獎金', validatedYearEndConfig.value);

    // 儲存三節獎金設定
    await upsertBonusConfig('FESTIVAL', '三節獎金', validatedFestivalConfig.value);

    return NextResponse.json({
      success: true,
      message: '設定已儲存'
    });

  } catch (error) {
    console.error('儲存獎金配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
