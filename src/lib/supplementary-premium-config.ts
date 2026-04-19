export interface SupplementaryPremiumSettings {
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

export const SUPPLEMENTARY_PREMIUM_SETTINGS_KEY = 'supplementary_premium_settings';

export const DEFAULT_SUPPLEMENTARY_PREMIUM_SETTINGS: SupplementaryPremiumSettings = {
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

export function getDefaultSupplementaryPremiumSettings(): SupplementaryPremiumSettings {
  return {
    ...DEFAULT_SUPPLEMENTARY_PREMIUM_SETTINGS,
    salaryIncludeItems: {
      ...DEFAULT_SUPPLEMENTARY_PREMIUM_SETTINGS.salaryIncludeItems,
    },
  };
}

export function normalizeSupplementaryPremiumSettings(
  input: Partial<SupplementaryPremiumSettings>
): SupplementaryPremiumSettings {
  const defaults = getDefaultSupplementaryPremiumSettings();

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

export function getSupplementaryPremiumRateDecimal(settings: SupplementaryPremiumSettings): number {
  return settings.premiumRate / 100;
}

export function getSupplementaryPremiumExemptThreshold(
  insuredAmount: number,
  settings: SupplementaryPremiumSettings
): number {
  return Math.max(0, insuredAmount) * Math.max(0, settings.exemptThresholdMultiplier);
}

export function getSupplementaryPremiumMinimumEligibleAmount(
  settings: SupplementaryPremiumSettings
): number {
  return Math.max(settings.minimumThreshold, settings.exemptionThreshold);
}
