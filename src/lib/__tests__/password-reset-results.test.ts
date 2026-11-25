import {
  getPasswordErrorReasons,
  getRetryItems,
  runBatchReset,
  summarizeBatchReset,
  type BatchResetItem,
  type BatchResetSendResult,
} from '@/lib/password-reset-results';

const makeItems = (count: number): BatchResetItem[] =>
  Array.from({ length: count }, (_, index) => ({
    userId: index + 1,
    name: `員工${index + 1}`,
    employeeId: `E00${index + 1}`,
    username: `user${index + 1}`,
    status: 'pending' as const,
  }));

const sequentialPasswords = () => {
  let next = 0;
  return () => `Pw-${++next}`;
};

const ok: BatchResetSendResult = { ok: true, status: 200 };

describe('batch password reset results', () => {
  it('reports 1 done, 1 unknown and 1 not sent when the connection drops on the second account', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await runBatchReset(makeItems(3), { send, generatePassword: sequentialPasswords() });

    expect(send).toHaveBeenCalledTimes(2); // 第 3 個沒有送出
    expect(result.map((item) => item.status)).toEqual(['done', 'unknown', 'pending']);
    expect(summarizeBatchReset(result)).toEqual({ done: 1, failed: 0, unknown: 1, pending: 1 });
    expect(result[0].password).toBe('Pw-1');
    expect(result[1].password).toBeUndefined(); // 結果不確定的帳號不顯示任何密碼
  });

  it('gives every account its own password', async () => {
    const send = jest.fn().mockResolvedValue(ok);

    const result = await runBatchReset(makeItems(3), { send, generatePassword: sequentialPasswords() });

    expect(send.mock.calls.map(([userId, password]) => [userId, password])).toEqual([
      [1, 'Pw-1'],
      [2, 'Pw-2'],
      [3, 'Pw-3'],
    ]);
    expect(new Set(result.map((item) => item.password)).size).toBe(3);
  });

  it('retries only unfinished accounts, unknown ones first, and never touches finished ones', async () => {
    const firstRun = await runBatchReset(makeItems(3), {
      send: jest.fn().mockResolvedValueOnce(ok).mockRejectedValueOnce(new Error('offline')),
      generatePassword: sequentialPasswords(),
    });
    expect(getRetryItems(firstRun).map((item) => item.userId)).toEqual([2, 3]);

    const send = jest.fn().mockResolvedValue(ok);
    const generatePassword = jest.fn().mockReturnValueOnce('Retry-2').mockReturnValueOnce('Retry-3');
    const retried = await runBatchReset(firstRun, { send, generatePassword });

    expect(send.mock.calls.map(([userId]) => userId)).toEqual([2, 3]);
    expect(retried.map((item) => item.status)).toEqual(['done', 'done', 'done']);
    expect(retried[0].password).toBe('Pw-1'); // 已完成的不重送、密碼不變
    expect(retried[1].password).toBe('Retry-2'); // 待確認的用新密碼覆蓋
    expect(summarizeBatchReset(retried)).toEqual({ done: 3, failed: 0, unknown: 0, pending: 0 });
  });

  it('keeps a rejected account as failed with the server reasons and carries on with the next one', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, error: '密碼不符合安全要求', reasons: ['不可重複使用目前密碼或最近 3 次密碼'] })
      .mockResolvedValueOnce(ok);

    const result = await runBatchReset(makeItems(2), { send, generatePassword: sequentialPasswords() });

    expect(result.map((item) => item.status)).toEqual(['failed', 'done']);
    expect(result[0].message).toBe('密碼不符合安全要求：不可重複使用目前密碼或最近 3 次密碼');
    expect(result[0].password).toBeUndefined();
  });

  it('treats a 5xx answer as unknown because the reset may have been applied', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce(ok);

    const result = await runBatchReset(makeItems(2), { send, generatePassword: sequentialPasswords() });

    expect(result.map((item) => item.status)).toEqual(['unknown', 'done']);
    expect(result[0].message).toContain('502');
  });

  it('reports progress after every state change without mutating earlier snapshots', async () => {
    const snapshots: string[][] = [];

    await runBatchReset(makeItems(2), {
      send: jest.fn().mockResolvedValue(ok),
      generatePassword: sequentialPasswords(),
      onChange: (items) => snapshots.push(items.map((item) => item.status)),
    });

    expect(snapshots).toEqual([
      ['sending', 'pending'],
      ['done', 'pending'],
      ['done', 'sending'],
      ['done', 'done'],
    ]);
  });

  it('extracts the reasons the server gives for a rejected password', () => {
    expect(getPasswordErrorReasons({ error: '密碼不符合安全要求', details: ['不可重複使用目前密碼或最近 3 次密碼'] }))
      .toEqual(['不可重複使用目前密碼或最近 3 次密碼']);
    expect(getPasswordErrorReasons({ error: '當前密碼錯誤' })).toEqual([]);
    expect(getPasswordErrorReasons(null)).toEqual([]);
    expect(getPasswordErrorReasons({ details: [1, '', '  ', '長度不足'] })).toEqual(['長度不足']);
  });
});
