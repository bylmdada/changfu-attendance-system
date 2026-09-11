export const DEFAULT_LATE_CLOCK_OUT_BUSINESS_REASON = '公務延後下班';

const LEGACY_DEV_LATE_CLOCK_OUT_REASON = 'code review、修正、收尾';

export function formatAttendanceClockReason(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }

  if (reason === 'PERSONAL') {
    return '非公務';
  }

  if (reason === 'BUSINESS' || reason === 'WORK' || reason === LEGACY_DEV_LATE_CLOCK_OUT_REASON) {
    return '公務';
  }

  return reason;
}

export function normalizeLateClockOutReason(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }

  if (reason === 'BUSINESS' || reason === 'WORK' || reason === LEGACY_DEV_LATE_CLOCK_OUT_REASON) {
    return 'BUSINESS';
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
