export function parsePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function parseBoundedPositiveInt(
  value: unknown,
  defaultValue: number,
  maxValue: number
): number {
  const parsed = parsePositiveInt(value);
  return Math.min(parsed ?? defaultValue, maxValue);
}
