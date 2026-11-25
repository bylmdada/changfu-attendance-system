/**
 * 密碼重置的結果判讀（純函式，不碰畫面與網路）。
 * 批次重置要逐帳號保留結果：已完成、明確失敗、結果待確認（連線中斷或伺服器沒正常回應）、尚未送出，
 * 重試時只處理沒完成的帳號。
 */

export type BatchResetStatus = 'pending' | 'sending' | 'done' | 'failed' | 'unknown';

export interface BatchResetItem {
  userId: number;
  name: string;
  employeeId: string;
  username: string;
  status: BatchResetStatus;
  /** 只有已完成的帳號有：這組就是目前生效的新密碼（每個帳號各一組） */
  password?: string;
  message?: string;
}

export interface BatchResetSendResult {
  ok: boolean;
  status: number;
  error?: string;
  reasons?: string[];
}

export interface BatchResetDeps {
  /** 送出一個帳號的重置；連線中斷時請直接 throw */
  send: (userId: number, password: string) => Promise<BatchResetSendResult>;
  generatePassword: () => string;
  onChange?: (items: BatchResetItem[]) => void;
}

/** 伺服器回傳的密碼政策／重用等具體原因（`details`），沒有就回空陣列。 */
export function getPasswordErrorReasons(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const details = (data as { details?: unknown }).details;
  return Array.isArray(details)
    ? details.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function summarizeBatchReset(items: BatchResetItem[]) {
  const summary = { done: 0, failed: 0, unknown: 0, pending: 0 };
  for (const item of items) {
    if (item.status === 'done') summary.done += 1;
    else if (item.status === 'failed') summary.failed += 1;
    else if (item.status === 'unknown') summary.unknown += 1;
    else summary.pending += 1;
  }
  return summary;
}

/** 要（重新）處理的帳號：先結果待確認的，再尚未送出的，最後明確失敗的；已完成的一律排除。 */
export function getRetryItems(items: BatchResetItem[]): BatchResetItem[] {
  const rank: Partial<Record<BatchResetStatus, number>> = { unknown: 0, pending: 1, sending: 1, failed: 2 };
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status !== 'done')
    .sort((a, b) => (rank[a.item.status] ?? 1) - (rank[b.item.status] ?? 1) || a.index - b.index)
    .map(({ item }) => item);
}

function describeFailure(result: BatchResetSendResult) {
  const reasons = result.reasons?.length ? `：${result.reasons.join('、')}` : '';
  return `${result.error || '重置失敗'}${reasons}`;
}

/**
 * 依序重置每個帳號，每個帳號各自產生一組新密碼。
 * 連線中斷時該帳號記為「待確認」並停止，後面的維持「尚未送出」；
 * 待確認的帳號重試時會產生新密碼，不論前一次有沒有生效，重試成功後生效的就是畫面上這組。
 */
export async function runBatchReset(initial: BatchResetItem[], deps: BatchResetDeps): Promise<BatchResetItem[]> {
  let items = initial.map((item) => ({ ...item }));
  const update = (userId: number, patch: Partial<BatchResetItem>) => {
    items = items.map((item) => (item.userId === userId ? { ...item, ...patch } : item));
    deps.onChange?.(items);
  };

  for (const target of getRetryItems(items)) {
    const password = deps.generatePassword();
    update(target.userId, { status: 'sending', password: undefined, message: undefined });

    let result: BatchResetSendResult;
    try {
      result = await deps.send(target.userId, password);
    } catch {
      update(target.userId, { status: 'unknown', message: '連線中斷，無法確認是否已重置' });
      // 連線有問題就先停，剩下的帳號維持原狀，等重試時再處理
      break;
    }

    if (result.ok) {
      update(target.userId, { status: 'done', password, message: undefined });
    } else if (result.status >= 500) {
      update(target.userId, { status: 'unknown', message: `伺服器沒有正常回應（${result.status}），無法確認是否已重置` });
    } else {
      update(target.userId, { status: 'failed', message: describeFailure(result) });
    }
  }

  return items;
}
