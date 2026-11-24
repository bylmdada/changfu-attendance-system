import { getTaiwanDayEnd, getTaiwanDayStart, toTaiwanDateStr } from '@/lib/timezone';

/**
 * 查詢期間的起日／迄日（YYYY-MM-DD，台北日期）→ 該日 00:00 與 23:59:59.999 的時間點。
 * 格式不對或日期不存在（例如 2026-02-31）回傳 null，由呼叫端回 400。
 */
export function parseTaiwanDayRange(value: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = getTaiwanDayStart(year, month, day);
  if (toTaiwanDateStr(start) !== value) return null;

  return { start, end: getTaiwanDayEnd(year, month, day) };
}

function toTaiwanDay(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toTaiwanDateStr(date);
}

/**
 * 紀錄（單日或起訖）與查詢期間是否重疊，以台北日期比較、含首尾兩天。
 * 起日、迄日各自生效，可以只填一個；兩個都填就是兩者的交集。
 * 伺服器端查詢請用 parseTaiwanDayRange 組 where 條件，語意與這個函式一致。
 */
export function overlapsTaiwanDateRange(
  start: string | Date,
  end: string | Date,
  rangeStart?: string,
  rangeEnd?: string
) {
  const startDay = toTaiwanDay(start);
  const endDay = toTaiwanDay(end);
  if (!startDay || !endDay) return false;
  if (rangeStart && endDay < rangeStart) return false;
  if (rangeEnd && startDay > rangeEnd) return false;
  return true;
}
