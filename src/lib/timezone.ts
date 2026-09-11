/**
 * 台灣時區工具函式
 * VPS 伺服器使用 UTC，需轉換為 Asia/Taipei (UTC+8) 來判斷日期
 */

const TAIWAN_TIMEZONE = 'Asia/Taipei';
const TAIWAN_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

type TaiwanDateParts = {
  year: number;
  month: number;
  day: number;
};

type TaiwanTimeParts = {
  hour: number;
  minute: number;
};

/** 取得台灣時區的當前時間（作為 Date 物件，各欄位為台灣時間） */
export function getTaiwanNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TAIWAN_TIMEZONE }));
}

/** 將任意時間轉換為台灣時區視角的 Date 物件 */
export function toTaiwanDate(d: Date): Date {
  return new Date(d.toLocaleString('en-US', { timeZone: TAIWAN_TIMEZONE }));
}

/** 取得任意 Date 在台灣時區的年月日欄位 */
export function getTaiwanDateParts(d: Date): TaiwanDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIWAN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('無法解析台灣時區日期');
  }

  return { year, month, day };
}

/** 取得任意 Date 在台灣時區的小時與分鐘欄位 */
export function getTaiwanTimeParts(d: Date): TaiwanTimeParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TAIWAN_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(d);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error('無法解析台灣時區時間');
  }

  return { hour, minute };
}

/** 將任意 Date 轉為台灣時區的 YYYY-MM-DD 字串 */
export function toTaiwanDateStr(d: Date): string {
  const tw = getTaiwanDateParts(d);
  const yyyy = tw.year;
  const mm = String(tw.month).padStart(2, '0');
  const dd = String(tw.day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** 取得台灣時區指定月份的 UTC 起始時間（台灣 00:00 = UTC 前一天 16:00） */
export function getTaiwanMonthStart(year: number, month1Based: number): Date {
  return new Date(Date.UTC(year, month1Based - 1, 1) - TAIWAN_UTC_OFFSET_MS);
}

/** 取得台灣時區指定月份的 UTC 結束時間（含當月最後一毫秒） */
export function getTaiwanMonthEnd(year: number, month1Based: number): Date {
  return new Date(getTaiwanMonthStart(year, month1Based + 1).getTime() - 1);
}

/** 取得台灣時區指定日期的 UTC 起始時間 */
export function getTaiwanDayStart(year: number, month1Based: number, day: number): Date {
  return new Date(Date.UTC(year, month1Based - 1, day) - TAIWAN_UTC_OFFSET_MS);
}

/** 取得台灣時區指定日期的 UTC 結束時間（含當日最後一毫秒） */
export function getTaiwanDayEnd(year: number, month1Based: number, day: number): Date {
  return new Date(getTaiwanDayStart(year, month1Based, day + 1).getTime() - 1);
}

/** 取得台灣時區「今日」的 UTC 起始時間（台灣 00:00 = UTC 前一天 16:00） */
export function getTaiwanTodayStart(now?: Date): Date {
  const tw = getTaiwanDateParts(now || new Date());
  return new Date(Date.UTC(tw.year, tw.month - 1, tw.day) - TAIWAN_UTC_OFFSET_MS);
}

/** 取得台灣時區「今日」的 UTC 結束時間（= 明日起始） */
export function getTaiwanTodayEnd(now?: Date): Date {
  return new Date(getTaiwanTodayStart(now).getTime() + 24 * 60 * 60 * 1000);
}

/** 取得台灣時區的年份 */
export function getTaiwanYear(d?: Date): number {
  return getTaiwanDateParts(d || new Date()).year;
}

/** 取得台灣時區的 YYYY-MM 字串 */
export function getTaiwanYearMonth(d?: Date): string {
  const tw = getTaiwanDateParts(d || new Date());
  return `${tw.year}-${String(tw.month).padStart(2, '0')}`;
}
