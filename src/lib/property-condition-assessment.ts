export const CONDITION_ASSESSMENT_STATUS = {
  NO_ABNORMALITY: 'NO_ABNORMALITY',
  ABNORMAL: 'ABNORMAL',
} as const;

export type ConditionAssessmentStatus =
  (typeof CONDITION_ASSESSMENT_STATUS)[keyof typeof CONDITION_ASSESSMENT_STATUS];

export const NORMAL_CONDITION_OPTIONS = [
  '輔具配件完整',
  '輔具結構穩固',
  '輔具清潔乾淨',
  '輔具消毒落實',
  '輔具零件無鬆脫、生鏽、進水',
  '電子輔具電量正常',
  '電子輔具充電正常',
  '電子輔具電源接口正常',
];

export const DEFAULT_NORMAL_CONDITION_ITEMS = NORMAL_CONDITION_OPTIONS.slice(0, 5);

export const ABNORMAL_CONDITION_OPTIONS = [
  '輔具配件',
  '輔具結構',
  '輔具清潔',
  '輔具消毒',
  '輔具零件',
  '電子輔具元件',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function uniqueAllowedItems(values: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return [...new Set(values)].filter((item) => allowedSet.has(item));
}

export function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export type ConditionAssessmentParseResult =
  | {
      ok: true;
      data: {
        conditionAssessmentStatus: ConditionAssessmentStatus;
        normalConditionItems: string[];
        abnormalConditionItems: string[];
        abnormalDescription: string | null;
        maintenanceStatus: 'DONE' | 'ABNORMAL';
        rawStatus: '無異常' | '有異常';
      };
    }
  | { ok: false; error: string };

export function parseConditionAssessmentInput(rawValue: unknown): ConditionAssessmentParseResult {
  if (!isPlainObject(rawValue)) {
    return { ok: false, error: '請填寫財產維護狀態評量' };
  }

  const status = rawValue.status;
  if (
    status !== CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY &&
    status !== CONDITION_ASSESSMENT_STATUS.ABNORMAL
  ) {
    return { ok: false, error: '請選擇財產維護狀態' };
  }

  if (status === CONDITION_ASSESSMENT_STATUS.NO_ABNORMALITY) {
    const normalItems = uniqueAllowedItems(
      toStringArray(rawValue.normalConditionItems),
      NORMAL_CONDITION_OPTIONS
    );
    if (normalItems.length === 0) {
      return { ok: false, error: '請至少勾選一項無異常財產狀態' };
    }

    return {
      ok: true,
      data: {
        conditionAssessmentStatus: status,
        normalConditionItems: normalItems,
        abnormalConditionItems: [],
        abnormalDescription: null,
        maintenanceStatus: 'DONE',
        rawStatus: '無異常',
      },
    };
  }

  const abnormalItems = uniqueAllowedItems(
    toStringArray(rawValue.abnormalConditionItems),
    ABNORMAL_CONDITION_OPTIONS
  );
  if (abnormalItems.length === 0) {
    return { ok: false, error: '請至少勾選一項財產異常狀態' };
  }

  const abnormalDescription = String(rawValue.abnormalDescription ?? '').trim();
  if (!abnormalDescription) {
    return { ok: false, error: '請詳細說明財產異常處' };
  }
  if (abnormalDescription.length > 2000) {
    return { ok: false, error: '財產異常說明不可超過 2000 字' };
  }

  return {
    ok: true,
    data: {
      conditionAssessmentStatus: status,
      normalConditionItems: [],
      abnormalConditionItems: abnormalItems,
      abnormalDescription,
      maintenanceStatus: 'ABNORMAL',
      rawStatus: '有異常',
    },
  };
}
