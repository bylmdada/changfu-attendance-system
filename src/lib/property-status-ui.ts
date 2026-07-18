/**
 * 前端用狀態顏色/標籤（client-safe，不引入 xlsx）。
 * 與 property-maintenance-utils 的 DISPLAY_STATUS_STYLE 對齊。
 */
export type DisplayStatus = 'OVERDUE' | 'TODAY' | 'PENDING' | 'DONE' | 'ABNORMAL';

export const STATUS_UI: Record<
  DisplayStatus,
  { label: string; badge: string; row: string; dot: string }
> = {
  OVERDUE: {
    label: '逾期',
    badge: 'bg-red-100 text-red-800 border border-red-200',
    row: 'border-l-4 border-red-500 bg-red-50',
    dot: 'bg-red-500',
  },
  TODAY: {
    label: '今日待維護',
    badge: 'bg-orange-100 text-orange-800 border border-orange-200',
    row: 'border-l-4 border-orange-500 bg-orange-50',
    dot: 'bg-orange-500',
  },
  PENDING: {
    label: '待維護',
    badge: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
    row: 'border-l-4 border-yellow-400 bg-yellow-50',
    dot: 'bg-yellow-400',
  },
  ABNORMAL: {
    label: '異常',
    badge: 'bg-red-100 text-red-800 border border-red-200',
    row: 'border-l-4 border-red-500 bg-red-50',
    dot: 'bg-red-500',
  },
  DONE: {
    label: '已完成',
    badge: 'bg-green-100 text-green-700 border border-green-200',
    row: 'border-l-4 border-green-400 bg-white',
    dot: 'bg-green-500',
  },
};

const TAIWAN_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TAIWAN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parseDateValue(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  return isNaN(date.getTime()) ? null : date;
}

export function fmtDate(d: string | Date | null | undefined): string {
  const date = parseDateValue(d);
  return date ? TAIWAN_DATE_FORMATTER.format(date) : '-';
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  const date = parseDateValue(d);
  return date ? TAIWAN_DATE_TIME_FORMATTER.format(date) : '-';
}

export function taiwanDateInputValue(d: string | Date | null | undefined): string {
  const date = parseDateValue(d);
  return date ? TAIWAN_DATE_FORMATTER.format(date) : '';
}
