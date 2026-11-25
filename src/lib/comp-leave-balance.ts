export interface CompLeaveBalanceAmounts {
  balance: number;
  pendingEarn: number;
  pendingUse: number;
}

/**
 * 補休「可用」時數 ＝ 已確認餘額 ＋ 待確認獲得 － 待確認使用。
 * 核准補休、個人查詢、管理頁與手動扣減都用這個口徑，同一個人同一時間看到的可用額度才會一致。
 */
export function getCompLeaveAvailableHours(balance: CompLeaveBalanceAmounts | null | undefined): number {
  if (!balance) return 0;

  return Math.round((balance.balance + balance.pendingEarn - balance.pendingUse) * 10000) / 10000;
}
