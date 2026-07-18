export interface InfectionControlInput {
  hasFever: boolean;
  temperature: number | null;
  hasAcuteCough: boolean;
}

export type InfectionClockType = 'in' | 'out';

type InfectionControlParseResult =
  | { ok: true; data: InfectionControlInput }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTemperature(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return Number.NaN;
  }

  return Math.round(numericValue * 10) / 10;
}

export function parseInfectionControlInput(rawValue: unknown): InfectionControlParseResult {
  if (!isPlainObject(rawValue)) {
    return { ok: false, error: '請完成感染管控聲明' };
  }

  if (typeof rawValue.hasFever !== 'boolean') {
    return { ok: false, error: '請選擇是否有發燒' };
  }

  if (typeof rawValue.hasAcuteCough !== 'boolean') {
    return { ok: false, error: '請選擇是否有急性咳嗽≧24小時' };
  }

  const temperature = parseTemperature(rawValue.temperature);

  if (Number.isNaN(temperature)) {
    return { ok: false, error: '體溫格式錯誤，請輸入數字' };
  }

  if (rawValue.hasFever) {
    if (temperature === null) {
      return { ok: false, error: '選擇有發燒時，請輸入體溫數值' };
    }

    if (temperature < 37.5 || temperature > 43) {
      return { ok: false, error: '發燒體溫需介於 37.5°C 至 43.0°C' };
    }
  } else if (temperature !== null) {
    return { ok: false, error: '選擇無發燒時，不需填寫體溫' };
  }

  return {
    ok: true,
    data: {
      hasFever: rawValue.hasFever,
      temperature,
      hasAcuteCough: rawValue.hasAcuteCough,
    },
  };
}

export function buildInfectionControlClockData(
  clockType: InfectionClockType,
  infectionControl: InfectionControlInput
) {
  if (clockType === 'in') {
    return {
      clockInHasFever: infectionControl.hasFever,
      clockInTemperature: infectionControl.temperature,
      clockInHasAcuteCough: infectionControl.hasAcuteCough,
    };
  }

  return {
    clockOutHasFever: infectionControl.hasFever,
    clockOutTemperature: infectionControl.temperature,
    clockOutHasAcuteCough: infectionControl.hasAcuteCough,
  };
}
