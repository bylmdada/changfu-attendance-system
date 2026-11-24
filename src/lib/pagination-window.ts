export type PageWindowItem = number | 'gap';

/**
 * 頁碼列只顯示：首頁、末頁、目前頁前後各 `siblings` 頁；中間缺很多頁用 'gap' 省略，
 * 只缺一頁時直接顯示該頁（用 … 代替一頁反而更不清楚）。
 * 資料量大時（例如 48,000 筆 ÷ 10 = 4,800 頁）按鈕數量也固定在 9 個以內。
 */
export function getPageWindow(current: number, totalPages: number, siblings = 2): PageWindowItem[] {
  if (!Number.isInteger(totalPages) || totalPages <= 0) return [];

  const wanted = new Set<number>([1, totalPages]);
  for (let page = current - siblings; page <= current + siblings; page++) {
    if (page >= 1 && page <= totalPages) wanted.add(page);
  }

  const items: PageWindowItem[] = [];
  let previous = 0;
  for (const page of [...wanted].sort((a, b) => a - b)) {
    const distance = page - previous;
    if (previous !== 0 && distance === 2) items.push(previous + 1);
    else if (previous !== 0 && distance > 2) items.push('gap');
    items.push(page);
    previous = page;
  }

  return items;
}
