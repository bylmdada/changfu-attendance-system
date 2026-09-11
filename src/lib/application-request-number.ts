export type ApplicationRequestNumberPrefix = 'LR' | 'OT' | 'MC' | 'SE';

function getTaiwanYearMonth(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? String(date.getFullYear());
  const month = parts.find((part) => part.type === 'month')?.value ?? String(date.getMonth() + 1).padStart(2, '0');

  return `${year}${month}`;
}

export function buildApplicationRequestNumber(
  prefix: ApplicationRequestNumberPrefix,
  id: number,
  createdAt: Date | string
): string {
  return `${prefix}-${getTaiwanYearMonth(createdAt)}-${String(id).padStart(4, '0')}`;
}
