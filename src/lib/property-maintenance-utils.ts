/**
 * 財產維護共用工具：頻率/狀態正規化、紀錄ID、Excel 日期、逾期衍生、顏色。
 */
import * as XLSX from 'xlsx';

// ── 維護頻率 → 天數（§4.2）。未知回 null（不自動產生任務，匯入時標記）。
export const FREQUENCY_DAYS: Record<string, number> = {
  每週一次: 7,
  兩週一次: 14,
  每月一次: 28,
  每季一次: 90,
  每半年一次: 180,
  每年一次: 365,
};

export function normalizeFrequencyDays(
  raw: string | null | undefined,
  overrides: Record<string, number> = {}
): number | null {
  if (!raw) return null;
  const key = String(raw).trim().replace(/\s+/g, '');
  if (key in overrides) return overrides[key];
  return FREQUENCY_DAYS[key] ?? null;
}

// ── 維護狀態正規化（§5）
export type MaintenanceStatus = 'PENDING' | 'DONE' | 'ABNORMAL';
/** 衍生顯示狀態（OVERDUE/TODAY 不存入 DB，查詢/渲染時計算） */
export type DisplayStatus = 'OVERDUE' | 'TODAY' | 'PENDING' | 'DONE' | 'ABNORMAL';

const STATUS_MAP: Record<string, MaintenanceStatus> = {
  待執行: 'PENDING',
  待維護: 'PENDING',
  PENDING: 'PENDING',
  已完成: 'DONE',
  完成: 'DONE',
  無異常: 'DONE',
  DONE: 'DONE',
  異常: 'ABNORMAL',
  有異常: 'ABNORMAL',
  ABNORMAL: 'ABNORMAL',
};

export function normalizeStatus(raw: string | null | undefined): MaintenanceStatus {
  if (!raw) return 'PENDING';
  const key = String(raw).trim();
  return STATUS_MAP[key] ?? 'PENDING';
}

export const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  PENDING: '待執行',
  DONE: '已完成',
  ABNORMAL: '異常',
};

// ── 日期工具
const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_PART_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function taipeiDateParts(d: Date): { year: number; month: number; day: number } {
  const parts = DATE_PART_FORMATTER.formatToParts(d);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

function taipeiMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - TAIPEI_UTC_OFFSET_MS);
}

export function startOfDay(d: Date = new Date()): Date {
  const parts = taipeiDateParts(d);
  return taipeiMidnight(parts.year, parts.month, parts.day);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isSameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

/** YYYY-MM-DD（台北時區） */
export function ymd(d: Date): string {
  const { year, month, day } = taipeiDateParts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function monthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: taipeiMidnight(year, month, 1),
    end: taipeiMidnight(year, month + 1, 1),
  };
}

export function taipeiYearMonth(d: Date = new Date()): { year: number; month: number } {
  const { year, month } = taipeiDateParts(d);
  return { year, month };
}

export function shiftYearMonth(
  year: number,
  month: number,
  offsetMonths: number
): { year: number; month: number } {
  const shifted = year * 12 + (month - 1) + offsetMonths;
  return {
    year: Math.floor(shifted / 12),
    month: (shifted % 12) + 1,
  };
}

/**
 * Excel 序號 / Date / ISO 字串 → Date（僅取年月日，丟棄時間小數避免時區飄移）。
 * 解析不出回 null。
 */
export function excelSerialToDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const parts = taipeiDateParts(value);
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }
  if (typeof value === 'number' && isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  const s = String(value).trim();
  if (!s) return null;
  // 純數字字串也當序號
  if (/^\d+(\.\d+)?$/.test(s)) {
    const parsed = XLSX.SSF.parse_date_code(Number(s));
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const parts = taipeiDateParts(d);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

// ── 紀錄ID：M-YYYY-MM-DD-{財產編號}（§27）
export function buildRecordId(assetCode: string, dueDate: Date): string {
  return `M-${ymd(dueDate)}-${assetCode}`;
}

// ── 逾期 / 顯示狀態衍生（§5.3）
export function isOverdue(
  status: MaintenanceStatus,
  dueDate: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (status !== 'PENDING' || !dueDate) return false;
  return startOfDay(dueDate).getTime() < startOfDay(now).getTime();
}

export function deriveDisplayStatus(
  status: MaintenanceStatus,
  dueDate: Date | null | undefined,
  now: Date = new Date()
): DisplayStatus {
  if (status === 'DONE') return 'DONE';
  if (status === 'ABNORMAL') return 'ABNORMAL';
  // PENDING
  if (dueDate) {
    const due = startOfDay(dueDate).getTime();
    const today = startOfDay(now).getTime();
    if (due < today) return 'OVERDUE';
    if (due === today) return 'TODAY';
  }
  return 'PENDING';
}

/** 首頁排序權重：逾期→今日→待執行→已完成（§6） */
export function displayStatusSortWeight(s: DisplayStatus): number {
  switch (s) {
    case 'OVERDUE':
      return 0;
    case 'TODAY':
      return 1;
    case 'PENDING':
      return 2;
    case 'ABNORMAL':
      return 3;
    case 'DONE':
      return 4;
  }
}

/** 狀態顏色（顏色即答案，§設計原則）。回傳 Tailwind class 片段。 */
export const DISPLAY_STATUS_STYLE: Record<
  DisplayStatus,
  { label: string; badge: string; dot: string }
> = {
  OVERDUE: { label: '逾期', badge: 'bg-red-100 text-red-800 border-red-200', dot: 'bg-red-500' },
  TODAY: { label: '今日待維護', badge: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
  PENDING: { label: '待維護', badge: 'bg-yellow-100 text-yellow-800 border-yellow-200', dot: 'bg-yellow-500' },
  ABNORMAL: { label: '異常', badge: 'bg-red-100 text-red-800 border-red-200', dot: 'bg-red-500' },
  DONE: { label: '已完成', badge: 'bg-green-100 text-green-700 border-green-200', dot: 'bg-green-500' },
};
