/**
 * 掃描／手動輸入的內容 → 查詢用的財產編號字串。
 * 純函式（前端掃碼頁與測試共用），不可引入 bwip-js 等 Node 專用套件。
 *
 * - http(s) 網址型 QR：取 ?code= / ?assetCode=，沒有就取路徑最後一段
 * - 其他一律原樣使用，包含新版條碼「據點代碼:財產編號」（例如 XIBEI:A001）。
 *   新版條碼長得像「協定:路徑」，若交給 URL 解析會被當成協定、只剩 A001，據點代碼就被丟掉了。
 */
export function normalizeScannedCode(decoded: string): string {
  const trimmed = decoded.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const codeFromQuery = url.searchParams.get('code') || url.searchParams.get('assetCode');
      if (codeFromQuery?.trim()) {
        return codeFromQuery.trim();
      }

      const lastSegment = url.pathname.split('/').filter(Boolean).pop();
      if (lastSegment?.trim()) {
        return lastSegment.trim();
      }
    } catch {
      // 看起來像網址但無法解析：直接使用原始掃描值
    }
  }

  return trimmed;
}
