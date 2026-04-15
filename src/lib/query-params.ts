interface IntegerQueryParamOptions {
  defaultValue?: number | null;
  min?: number;
  max?: number;
}

interface YearMonthQueryParamOptions {
  defaultValue?: string | null;
  minYear?: number;
  maxYear?: number;
}

export function parseIntegerQueryParam(
  rawValue: string | null,
  options: IntegerQueryParamOptions = {}
) {
  if (rawValue === null || rawValue === '') {
    return {
      value: options.defaultValue ?? null,
      isValid: true,
    };
  }

  if (!/^-?\d+$/.test(rawValue)) {
    return { value: null, isValid: false };
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    return { value: null, isValid: false };
  }

  if ((options.min !== undefined && value < options.min) || (options.max !== undefined && value > options.max)) {
    return { value: null, isValid: false };
  }

  return { value, isValid: true };
}

export function parseYearMonthQueryParam(
  rawValue: string | null,
  options: YearMonthQueryParamOptions = {}
) {
  if (rawValue === null || rawValue === '') {
    return {
      value: options.defaultValue ?? null,
      isValid: true,
    };
  }

  const match = rawValue.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return { value: null, isValid: false };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const minYear = options.minYear ?? 1900;
  const maxYear = options.maxYear ?? 9999;

  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month)) {
    return { value: null, isValid: false };
  }

  if (year < minYear || year > maxYear || month < 1 || month > 12) {
    return { value: null, isValid: false };
  }

  return {
    value: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
    isValid: true,
  };
}

export function isValidCompactDate(rawValue: string): boolean {
  if (!/^\d{8}$/.test(rawValue)) {
    return false;
  }

  const year = Number(rawValue.slice(0, 4));
  const month = Number(rawValue.slice(4, 6));
  const day = Number(rawValue.slice(6, 8));

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  return parsedDate.getUTCFullYear() === year && parsedDate.getUTCMonth() === month - 1 && parsedDate.getUTCDate() === day;
}