export const DEFAULT_LATE_CLOCK_OUT_BUSINESS_REASON = 'code review、修正、收尾';

export function formatAttendanceClockReason(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }

  if (reason === 'PERSONAL') {
    return '非公務';
  }

  if (reason === 'BUSINESS' || reason === 'WORK') {
    return '公務';
  }

  return reason;
}

export function normalizeLateClockOutReason(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }

  if (reason === 'BUSINESS' || reason === 'WORK') {
    return DEFAULT_LATE_CLOCK_OUT_BUSINESS_REASON;
  }

  return reason;
}

export function normalizeClockReasonForStorage(
  clockType: 'in' | 'out',
  reason: string
): string {
  if (clockType === 'out') {
    return normalizeLateClockOutReason(reason) ?? reason;
  }

  return reason;
}
