export type PropertyAuditStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

const STATUS_MAP: Record<string, PropertyAuditStatus> = {
  PENDING: 'PENDING',
  待主管稽核: 'PENDING',
  APPROVED: 'APPROVED',
  已通過: 'APPROVED',
  REJECTED: 'REJECTED',
  退回補正: 'REJECTED',
};

export function normalizePropertyAuditStatus(
  value: string | null | undefined
): PropertyAuditStatus | null {
  if (!value) return null;
  return STATUS_MAP[value.trim()] ?? null;
}

export function propertyAuditStatusLabel(value: string | null | undefined): string {
  const status = normalizePropertyAuditStatus(value);
  if (status === 'PENDING') return '待主管稽核';
  if (status === 'APPROVED') return '已通過';
  if (status === 'REJECTED') return '退回補正';
  return value || '—';
}
