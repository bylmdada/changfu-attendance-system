export type ScheduleConfirmStatus =
  | 'NOT_RELEASED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'NEED_RECONFIRM'
  | 'EXPIRED';

export const SCHEDULE_ALL_DEPARTMENTS = '__ALL__';

type ScheduleReleaseCandidate = {
  id: number;
  department: string | null;
  publishedAt: Date;
  version: number;
};

export function getScheduleReleaseDepartmentFilters(department?: string | null) {
  const normalizedDepartment = department?.trim();
  return [
    ...(normalizedDepartment ? [{ department: normalizedDepartment }] : []),
    { department: null },
    { department: SCHEDULE_ALL_DEPARTMENTS },
  ];
}

export function pickApplicableScheduleRelease<T extends ScheduleReleaseCandidate>(
  releases: T[],
  department?: string | null
): T | null {
  const normalizedDepartment = department?.trim() || '';
  const isGlobal = (release: T) => (
    release.department === null || release.department === SCHEDULE_ALL_DEPARTMENTS
  );

  return releases
    .filter((release) => isGlobal(release) || release.department === normalizedDepartment)
    .sort((left, right) => {
      const scopeDiff = Number(right.department === normalizedDepartment) - Number(left.department === normalizedDepartment);
      if (scopeDiff !== 0) return scopeDiff;
      const publishDiff = right.publishedAt.getTime() - left.publishedAt.getTime();
      if (publishDiff !== 0) return publishDiff;
      const versionDiff = right.version - left.version;
      return versionDiff !== 0 ? versionDiff : right.id - left.id;
    })[0] ?? null;
}

export const SCHEDULE_CONFIRM_STATUS_OPTIONS: Array<{
  value: ScheduleConfirmStatus;
  label: string;
}> = [
  { value: 'NOT_RELEASED', label: '未發布' },
  { value: 'PENDING', label: '待確認' },
  { value: 'CONFIRMED', label: '已確認' },
  { value: 'NEED_RECONFIRM', label: '需重新確認' },
  { value: 'EXPIRED', label: '已逾期' },
];

export function isScheduleConfirmStatus(value: string): value is ScheduleConfirmStatus {
  return SCHEDULE_CONFIRM_STATUS_OPTIONS.some((option) => option.value === value);
}

export function getScheduleConfirmStatusLabel(status: ScheduleConfirmStatus) {
  return (
    SCHEDULE_CONFIRM_STATUS_OPTIONS.find((option) => option.value === status)?.label
    ?? status
  );
}

export function getScheduleConfirmStatusBadgeClass(status: ScheduleConfirmStatus) {
  switch (status) {
    case 'CONFIRMED':
      return 'border-green-200 bg-green-50 text-green-700';
    case 'NEED_RECONFIRM':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case 'EXPIRED':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'NOT_RELEASED':
      return 'border-slate-200 bg-slate-50 text-slate-700';
    case 'PENDING':
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
}
