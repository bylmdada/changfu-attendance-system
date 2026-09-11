import { prisma } from '@/lib/database';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

export const BONUS_DEPARTMENT_CONFIGS_KEY = 'bonus_department_configs';

export interface BonusConfigPayload {
  bonusTypeName?: string;
  isActive?: boolean;
  defaultAmount?: number | null;
  eligibilityRules?: Record<string, unknown>;
  paymentSchedule?: Record<string, unknown>;
}

export type DepartmentBonusConfigStore = Record<string, Partial<Record<string, BonusConfigPayload>>>;

export interface BonusConfigurationRecord {
  bonusType: string;
  bonusTypeName?: string | null;
  isActive?: boolean | null;
  defaultAmount?: number | null;
  eligibilityRules?: unknown;
  paymentSchedule?: unknown;
}

export interface ResolvedBonusConfiguration {
  bonusType: string;
  bonusTypeName: string;
  isActive: boolean;
  defaultAmount: number | null;
  eligibilityRules: Record<string, unknown>;
  paymentSchedule: Record<string, unknown>;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBonusConfigField(
  rawValue: unknown,
  fallback: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  if (typeof rawValue === 'string') {
    return safeParseSystemSettingsValue(rawValue, fallback, key);
  }

  if (isPlainObject(rawValue)) {
    return rawValue;
  }

  return fallback;
}

export function normalizeStoredBonusConfig(
  config: BonusConfigurationRecord | null | undefined,
  defaultName: string,
  bonusType: string
): ResolvedBonusConfiguration {
  return {
    bonusType,
    bonusTypeName: config?.bonusTypeName || defaultName,
    isActive: config?.isActive !== false,
    defaultAmount: typeof config?.defaultAmount === 'number' ? config.defaultAmount : null,
    eligibilityRules: parseBonusConfigField(config?.eligibilityRules, {}, `${bonusType}.eligibilityRules`),
    paymentSchedule: parseBonusConfigField(config?.paymentSchedule, {}, `${bonusType}.paymentSchedule`),
  };
}

export function mergeBonusConfigOverride(
  baseConfig: ResolvedBonusConfiguration,
  override: BonusConfigPayload | undefined
): ResolvedBonusConfiguration {
  if (!override) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    bonusTypeName: override.bonusTypeName ?? baseConfig.bonusTypeName,
    isActive: override.isActive ?? baseConfig.isActive,
    defaultAmount:
      override.defaultAmount === undefined ? baseConfig.defaultAmount : override.defaultAmount,
    eligibilityRules: override.eligibilityRules ?? baseConfig.eligibilityRules,
    paymentSchedule: override.paymentSchedule ?? baseConfig.paymentSchedule,
  };
}

export function normalizeDepartmentBonusConfigStore(value: unknown): DepartmentBonusConfigStore {
  if (!isPlainObject(value)) {
    return {};
  }

  const normalized: DepartmentBonusConfigStore = {};

  for (const [department, rawConfigs] of Object.entries(value)) {
    if (!isPlainObject(rawConfigs)) {
      continue;
    }

    const departmentConfigs: Partial<Record<string, BonusConfigPayload>> = {};

    for (const [bonusType, rawConfig] of Object.entries(rawConfigs)) {
      if (!isPlainObject(rawConfig)) {
        continue;
      }

      const normalizedConfig: BonusConfigPayload = {};

      if (typeof rawConfig.bonusTypeName === 'string') {
        normalizedConfig.bonusTypeName = rawConfig.bonusTypeName;
      }
      if (typeof rawConfig.isActive === 'boolean') {
        normalizedConfig.isActive = rawConfig.isActive;
      }
      if (rawConfig.defaultAmount === null) {
        normalizedConfig.defaultAmount = null;
      } else if (typeof rawConfig.defaultAmount === 'number' && Number.isFinite(rawConfig.defaultAmount)) {
        normalizedConfig.defaultAmount = rawConfig.defaultAmount;
      }
      if (isPlainObject(rawConfig.eligibilityRules)) {
        normalizedConfig.eligibilityRules = rawConfig.eligibilityRules;
      }
      if (isPlainObject(rawConfig.paymentSchedule)) {
        normalizedConfig.paymentSchedule = rawConfig.paymentSchedule;
      }

      departmentConfigs[bonusType] = normalizedConfig;
    }

    normalized[department] = departmentConfigs;
  }

  return normalized;
}

export async function getStoredDepartmentBonusConfigs(
  db: Pick<typeof prisma, 'systemSettings'> = prisma
): Promise<DepartmentBonusConfigStore> {
  const settingModel = (db as typeof prisma & {
    systemSettings?: {
      findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>;
    };
  }).systemSettings;

  if (!settingModel?.findUnique) {
    return {};
  }

  const storedSetting = await settingModel.findUnique({
    where: { key: BONUS_DEPARTMENT_CONFIGS_KEY },
  });

  if (!storedSetting?.value) {
    return {};
  }

  return normalizeDepartmentBonusConfigStore(
    safeParseSystemSettingsValue<Record<string, unknown>>(
      storedSetting.value,
      {},
      BONUS_DEPARTMENT_CONFIGS_KEY
    )
  );
}

export function resolveEffectiveBonusConfig(params: {
  bonusType: string;
  defaultName: string;
  config: BonusConfigurationRecord | null | undefined;
  department: string | null | undefined;
  departmentConfigs: DepartmentBonusConfigStore;
}): ResolvedBonusConfiguration {
  const { bonusType, defaultName, config, department, departmentConfigs } = params;
  const baseConfig = normalizeStoredBonusConfig(config, defaultName, bonusType);
  const departmentName = typeof department === 'string' ? department.trim() : '';

  if (!departmentName) {
    return baseConfig;
  }

  return mergeBonusConfigOverride(baseConfig, departmentConfigs[departmentName]?.[bonusType]);
}
