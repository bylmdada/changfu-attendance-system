import type { Prisma } from '@prisma/client';
import { DEFAULT_LEAVE_RULES_SETTINGS } from '@/lib/leave-rules-config-defaults';
import { getTaiwanTodayDateOnly } from '@/lib/timezone';

/**
 * 去年度特休剩餘（延休）的共同判斷。
 * 「特休假與補休設定」有兩個欄位：允許特休遞延、遞延上限（0＝不限制）。
 * 查詢頁要不要把去年度剩餘列為「可延休」、核准請假時能不能扣去年度額度，都以這裡為準，
 * 兩邊才不會一邊顯示延休 2 天、另一邊卻回「特休餘額不足」。
 */
export interface AnnualLeaveCarryOverPolicy {
  enabled: boolean;
  /** 0 = 不限制 */
  maxDays: number;
}

export type CarryOverStatus = 'USABLE' | 'EXPIRED' | 'NOT_ENABLED';

type CarryOverRow = { remainingDays: number; expiryDate: Date | string };

export const DEFAULT_CARRY_OVER_POLICY: AnnualLeaveCarryOverPolicy = {
  enabled: DEFAULT_LEAVE_RULES_SETTINGS.annualLeaveRollover,
  maxDays: DEFAULT_LEAVE_RULES_SETTINGS.annualLeaveRolloverMax,
};

/** 去年度還有剩餘時的狀態：可用／已到期（歷史餘額）／系統未啟用遞延（歷史餘額）。沒有剩餘回傳 null。 */
export function getCarryOverStatus(
  lastYear: CarryOverRow | null | undefined,
  policy: AnnualLeaveCarryOverPolicy,
  onDate: Date
): CarryOverStatus | null {
  if (!lastYear || lastYear.remainingDays <= 0) return null;
  if (new Date(lastYear.expiryDate).getTime() < onDate.getTime()) return 'EXPIRED';
  if (!policy.enabled) return 'NOT_ENABLED';
  return 'USABLE';
}

/** 去年度能實際拿來扣的天數（已到期、未啟用遞延都是 0；有上限時最多上限天數）。 */
export function getUsableCarryOverDays(
  lastYear: CarryOverRow | null | undefined,
  policy: AnnualLeaveCarryOverPolicy,
  onDate: Date
): number {
  if (getCarryOverStatus(lastYear, policy, onDate) !== 'USABLE') return 0;

  const remaining = lastYear!.remainingDays;
  return policy.maxDays > 0 ? Math.min(remaining, policy.maxDays) : remaining;
}

/** 讀取遞延設定；可在交易內用（傳交易用戶端）。讀不到或沒有設定就用預設（不允許遞延）。 */
export async function readAnnualLeaveCarryOverPolicy(
  client: Partial<Pick<Prisma.TransactionClient, 'leaveRulesConfig'>>
): Promise<AnnualLeaveCarryOverPolicy> {
  if (!client.leaveRulesConfig?.findFirst) return DEFAULT_CARRY_OVER_POLICY;

  const config = await client.leaveRulesConfig.findFirst({
    where: { isActive: true, effectiveDate: { lte: getTaiwanTodayDateOnly() } },
    orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
    select: { annualLeaveRollover: true, annualLeaveRolloverMax: true },
  });

  return config
    ? { enabled: config.annualLeaveRollover, maxDays: config.annualLeaveRolloverMax }
    : DEFAULT_CARRY_OVER_POLICY;
}
