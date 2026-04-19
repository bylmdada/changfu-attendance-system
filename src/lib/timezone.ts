/**
 * 台灣時區工具函式
 * VPS 伺服器使用 UTC，需轉換為 Asia/Taipei (UTC+8) 來判斷日期
 */

/** 取得台灣時區的當前時間（作為 Date 物件，各欄位為台灣時間） */
export function getTaiwanNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

/** 將任意時間轉換為台灣時區視角的 Date 物件 */
export function toTaiwanDate(d: Date): Date {
  return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

/** 將任意 Date 轉為台灣時區的 YYYY-MM-DD 字串 */
export function toTaiwanDateStr(d: Date): string {
  const tw = toTaiwanDate(d);
  const yyyy = tw.getFullYear();
  const mm = String(tw.getMonth() + 1).padStart(2, '0');
  const dd = String(tw.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** 取得台灣時區「今日」的 UTC 起始時間（台灣 00:00 = UTC 前一天 16:00） */
export function getTaiwanTodayStart(now?: Date): Date {
  const tw = new Date((now || new Date()).toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return new Date(Date.UTC(tw.getFullYear(), tw.getMonth(), tw.getDate()) - 8 * 60 * 60 * 1000);
}

/** 取得台灣時區「今日」的 UTC 結束時間（= 明日起始） */
export function getTaiwanTodayEnd(now?: Date): Date {
  return new Date(getTaiwanTodayStart(now).getTime() + 24 * 60 * 60 * 1000);
}

/** 取得台灣時區的年份 */
export function getTaiwanYear(d?: Date): number {
  const tw = new Date((d || new Date()).toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return tw.getFullYear();
}

/** 取得台灣時區的 YYYY-MM 字串 */
export function getTaiwanYearMonth(d?: Date): string {
  const tw = new Date((d || new Date()).toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return `${tw.getFullYear()}-${String(tw.getMonth() + 1).padStart(2, '0')}`;
}
