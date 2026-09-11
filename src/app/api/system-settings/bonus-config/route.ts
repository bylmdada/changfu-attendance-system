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
import {
  BONUS_DEPARTMENT_CONFIGS_KEY,
  getStoredDepartmentBonusConfigs,
  isPlainObject,
  normalizeStoredBonusConfig,
  parseBonusConfigField,
  type BonusConfigPayload,
  type DepartmentBonusConfigStore,
  type ResolvedBonusConfiguration,
} from '@/lib/bonus-config';
import { logSystemSettingsChange } from '@/lib/system-settings-audit';

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

  const { bonusTypeName, defaultAmount, eligibilityRules, paymentSchedule } = config;
  const isActive = (config as Record<string, unknown>).isActive;

  if (bonusTypeName !== undefined && typeof bonusTypeName !== 'string') {
    return { error: `${label}名稱必須為字串` };
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    return { error: `${label}啟用狀態必須為布林值` };
  }

  if (defaultAmount !== undefined && defaultAmount !== null && (typeof defaultAmount !== 'number' || !Number.isFinite(defaultAmount))) {
    return { error: `${label}預設金額必須為有效數字` };
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
      isActive: isActive as boolean | undefined,
      defaultAmount: defaultAmount as number | null | undefined,
      eligibilityRules: eligibilityRules as Record<string, unknown> | undefined,
      paymentSchedule: paymentSchedule as Record<string, unknown> | undefined,
    },
  };
}

function buildMergedConfig(
  existingConfig: ResolvedBonusConfiguration,
  incomingConfig?: BonusConfigPayload
): ResolvedBonusConfiguration {
  return {
    bonusType: existingConfig.bonusType,
    bonusTypeName: incomingConfig?.bonusTypeName ?? existingConfig.bonusTypeName,
    isActive: incomingConfig?.isActive ?? existingConfig.isActive,
    defaultAmount:
      incomingConfig?.defaultAmount === undefined
        ? existingConfig.defaultAmount
        : incomingConfig.defaultAmount,
    eligibilityRules: incomingConfig?.eligibilityRules ?? existingConfig.eligibilityRules,
    paymentSchedule: incomingConfig?.paymentSchedule ?? existingConfig.paymentSchedule,
  };
}

async function upsertBonusConfig(
  db: Pick<typeof prisma, 'bonusConfiguration'>,
  bonusType: 'YEAR_END' | 'FESTIVAL',
  defaultName: string,
  incomingConfig?: BonusConfigPayload
) {
  if (!incomingConfig) {
    return;
  }

  const existingRecord = await db.bonusConfiguration.findFirst({
    where: { bonusType },
    orderBy: { id: 'asc' },
  }) as {
    id: number;
    bonusType: string;
    bonusTypeName?: string | null;
    isActive?: boolean | null;
    defaultAmount?: number | null;
    eligibilityRules?: unknown;
    paymentSchedule?: unknown;
  } | null;

  const existingConfig = normalizeStoredBonusConfig(
    existingRecord,
    defaultName,
    bonusType
  );

  const mergedConfig = buildMergedConfig(existingConfig, incomingConfig);

  if (existingRecord) {
    await db.bonusConfiguration.update({
      where: { id: existingRecord.id },
      data: {
        bonusTypeName: mergedConfig.bonusTypeName,
        defaultAmount: mergedConfig.defaultAmount,
        eligibilityRules: JSON.stringify(mergedConfig.eligibilityRules),
        paymentSchedule: JSON.stringify(mergedConfig.paymentSchedule),
        isActive: mergedConfig.isActive,
      } as never,
    });
    return;
  }

  await db.bonusConfiguration.create({
    data: {
      bonusType,
      bonusTypeName: mergedConfig.bonusTypeName,
      defaultAmount: mergedConfig.defaultAmount,
      eligibilityRules: JSON.stringify(mergedConfig.eligibilityRules),
      paymentSchedule: JSON.stringify(mergedConfig.paymentSchedule),
      isActive: mergedConfig.isActive,
    } as never,
  });
}

function validateDepartmentConfigs(
  input: unknown
): { value?: DepartmentBonusConfigStore; error?: string } {
  if (input === undefined) {
    return {};
  }

  if (!isPlainObject(input)) {
    return { error: '部門獎金設定格式無效' };
  }

  const validatedConfigs: DepartmentBonusConfigStore = {};

  for (const [department, rawConfigs] of Object.entries(input)) {
    if (!isPlainObject(rawConfigs)) {
      return { error: `${department} 部門獎金設定格式無效` };
    }

    const departmentConfigs: Partial<Record<string, BonusConfigPayload>> = {};

    for (const [bonusType, rawConfig] of Object.entries(rawConfigs)) {
      const label =
        bonusType === 'YEAR_END'
          ? `${department}部門年終獎金`
          : bonusType === 'FESTIVAL'
            ? `${department}部門三節獎金`
            : `${department}部門${bonusType}`;

      const validated = validateIncomingConfig(rawConfig, label);
      if (validated.error) {
        return { error: validated.error };
      }

      if (validated.value) {
        departmentConfigs[bonusType] = validated.value;
      }
    }

    validatedConfigs[department] = departmentConfigs;
  }

  return { value: validatedConfigs };
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
    const departmentConfigs = await getStoredDepartmentBonusConfigs();

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
      configs: parsedConfigs,
      departmentConfigs
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
      departmentConfigs,
    } = data as {
      yearEndConfig?: BonusConfigPayload;
      festivalConfig?: BonusConfigPayload;
      departmentConfigs?: DepartmentBonusConfigStore;
    };

    const validatedYearEndConfig = validateIncomingConfig(yearEndConfig, '年終獎金');
    if (validatedYearEndConfig.error) {
      return NextResponse.json({ error: validatedYearEndConfig.error }, { status: 400 });
    }

    const validatedFestivalConfig = validateIncomingConfig(festivalConfig, '三節獎金');
    if (validatedFestivalConfig.error) {
      return NextResponse.json({ error: validatedFestivalConfig.error }, { status: 400 });
    }

    const validatedDepartmentConfigs = validateDepartmentConfigs(departmentConfigs);
    if (validatedDepartmentConfigs.error) {
      return NextResponse.json({ error: validatedDepartmentConfigs.error }, { status: 400 });
    }

    const [oldBonusConfigs, oldDepartmentConfigs] = await Promise.all([
      prisma.bonusConfiguration.findMany({ orderBy: { bonusType: 'asc' } }),
      getStoredDepartmentBonusConfigs(),
    ]);

    await prisma.$transaction(async (tx) => {
      await upsertBonusConfig(tx, 'YEAR_END', '年終獎金', validatedYearEndConfig.value);
      await upsertBonusConfig(tx, 'FESTIVAL', '三節獎金', validatedFestivalConfig.value);

      if (validatedDepartmentConfigs.value !== undefined) {
        await tx.systemSettings.upsert({
          where: { key: BONUS_DEPARTMENT_CONFIGS_KEY },
          update: {
            value: JSON.stringify(validatedDepartmentConfigs.value),
            description: '部門別獎金配置',
          } as never,
          create: {
            key: BONUS_DEPARTMENT_CONFIGS_KEY,
            value: JSON.stringify(validatedDepartmentConfigs.value),
            description: '部門別獎金配置',
          } as never,
        });
      }
    });

    const [newBonusConfigs, newDepartmentConfigs] = await Promise.all([
      prisma.bonusConfiguration.findMany({ orderBy: { bonusType: 'asc' } }),
      getStoredDepartmentBonusConfigs(),
    ]);

    await logSystemSettingsChange({
      request,
      user,
      settingKey: 'bonus-config',
      description: '獎金配置設定變更',
      oldValue: { configs: oldBonusConfigs, departmentConfigs: oldDepartmentConfigs },
      newValue: { configs: newBonusConfigs, departmentConfigs: newDepartmentConfigs },
    });

    return NextResponse.json({
      success: true,
      message: '設定已儲存'
    });

  } catch (error) {
    console.error('儲存獎金配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
