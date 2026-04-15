const DANGEROUS_CSV_PREFIX = /^[\t\r ]*[=+\-@]/;

export function escapeCsvValue(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const safeValue = typeof value === 'string' && DANGEROUS_CSV_PREFIX.test(raw)
    ? `'${raw}`
    : raw;

  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }

  return safeValue;
}

export function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsvValue).join(',');
}