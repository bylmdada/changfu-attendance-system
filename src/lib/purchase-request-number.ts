/**
 * 請購單號 PR-YYYYMM-NNN：序號至少三位，超過 999 張就自然變四位（PR-202611-1000）。
 * 單號是文字，用字串排序會把 999 排在 1000 後面，取「最後一張」再加一就會一直重取 1000；
 * 所以要把序號當數字找最大值。其他月份、其他格式的單號一律忽略。
 */
export function getNextPurchaseRequestSequence(requestNumbers: string[], prefix: string): number {
  let max = 0;

  for (const requestNumber of requestNumbers) {
    if (!requestNumber.startsWith(`${prefix}-`)) continue;

    const sequencePart = requestNumber.slice(prefix.length + 1);
    if (!/^\d+$/.test(sequencePart)) continue;

    max = Math.max(max, Number(sequencePart));
  }

  return max + 1;
}

export function formatPurchaseRequestNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}
