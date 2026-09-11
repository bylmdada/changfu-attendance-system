import { toTaiwanDateStr } from '@/lib/timezone';
import { STANDARD_REGULAR_HOURS } from '@/lib/work-hours';

export interface ApprovedOvertimeRequestSource {
  id: number;
  employeeId: number;
  overtimeDate: Date;
  totalHours: number | null;
  compensationType?: string | null;
}

export interface AttendanceApprovedOvertimeSource {
  employeeId: number;
  workDate: Date;
  regularHours?: number | null;
  actualWorkHours?: number | null;
  overtimeHours: number | null;
  clockInOvertimeId?: number | null;
  clockOutOvertimeId?: number | null;
  overtimeType?: 'WEEKDAY' | 'REST_DAY' | 'HOLIDAY' | 'MANDATORY_REST' | null;
}

export interface IndexedApprovedOvertimeRequests {
  byEmployeeDate: Map<string, ApprovedOvertimeRequestSource[]>;
  byId: Map<number, ApprovedOvertimeRequestSource>;
}

export interface ResolvedApprovedAttendanceOvertime {
  hasApprovedRequest: boolean;
  approvedRequestIds: number[];
  rawAttendanceHours: number;
  approvedRequestHours: number;
  approvedWorkedHours: number;
  regularHours: number;
  effectiveHours: number;
  payableHours: number;
  compLeaveHours: number;
}

export type AttendanceOvertimeType = NonNullable<AttendanceApprovedOvertimeSource['overtimeType']>;

export function resolveAttendanceOvertimeType(params: {
  shiftType?: string | null;
  workDate: Date;
  isHoliday?: boolean;
}): AttendanceOvertimeType {
  if (params.isHoliday || params.shiftType === 'NH') return 'HOLIDAY';
  if (params.shiftType === 'rd') return 'REST_DAY';
  if (params.shiftType === 'RD') return 'MANDATORY_REST';
  if (params.shiftType) return 'WEEKDAY';

  const day = new Date(`${toTaiwanDateStr(params.workDate)}T00:00:00.000Z`).getUTCDay();
  if (day === 6) return 'REST_DAY';
  if (day === 0) return 'MANDATORY_REST';
  return 'WEEKDAY';
}

function toEmployeeDateKey(employeeId: number, workDate: Date) {
  return `${employeeId}-${toTaiwanDateStr(workDate)}`;
}

function roundHours(hours: number) {
  return Math.round(hours * 100) / 100;
}

function normalizeApprovedRequestHours(requests: ApprovedOvertimeRequestSource[]) {
  const rawHours = requests.reduce(
    (summary, request) => {
      const hours = Math.max(0, request.totalHours || 0);

      if (hours <= 0) {
        return summary;
      }

      summary.total += hours;
      if (request.compensationType === 'OVERTIME_PAY') {
        summary.payable += hours;
      } else {
        summary.compLeave += hours;
      }

      return summary;
    },
    { total: 0, payable: 0, compLeave: 0 }
  );

  // 最小單位僅是申請門檻；申請通過後，起訖時間所代表的分鐘不得被捨去。
  const total = roundHours(rawHours.total);
  const payable = Math.min(total, roundHours(rawHours.payable));
  const compLeave = Math.min(Math.max(0, total - payable), roundHours(rawHours.compLeave));

  return { total, payable, compLeave };
}

export function indexApprovedOvertimeRequests(
  requests: ApprovedOvertimeRequestSource[]
): IndexedApprovedOvertimeRequests {
  const byEmployeeDate = new Map<string, ApprovedOvertimeRequestSource[]>();
  const byId = new Map<number, ApprovedOvertimeRequestSource>();

  for (const request of requests) {
    const key = toEmployeeDateKey(request.employeeId, request.overtimeDate);
    byId.set(request.id, request);
    byEmployeeDate.set(key, [...(byEmployeeDate.get(key) || []), request]);
  }

  return { byEmployeeDate, byId };
}

export function resolveApprovedAttendanceOvertime(
  record: AttendanceApprovedOvertimeSource,
  approvedRequestsIndex: IndexedApprovedOvertimeRequests,
  unitMinutes: number
): ResolvedApprovedAttendanceOvertime {
  // 保留參數以相容既有呼叫端；最低申請單位不得影響實際認列分鐘。
  void unitMinutes;
  // The configured minimum unit governs what may be requested, not whether
  // minutes that were actually worked disappear from the statutory result.
  const rawAttendanceHours = roundHours(Math.max(0, record.overtimeHours || 0));
  const baseRegularHours = roundHours(Math.max(
    0,
    record.regularHours ?? STANDARD_REGULAR_HOURS
  ));
  const actualWorkHours = roundHours(Math.max(
    0,
    record.actualWorkHours ?? (baseRegularHours + rawAttendanceHours)
  ));
  const linkedRequestIds = [...new Set([record.clockInOvertimeId, record.clockOutOvertimeId])]
    .filter((value): value is number => typeof value === 'number' && value > 0);

  const relevantRequests = linkedRequestIds.length > 0
    ? linkedRequestIds
        .map(id => approvedRequestsIndex.byId.get(id))
        .filter((request): request is ApprovedOvertimeRequestSource => Boolean(request))
    : approvedRequestsIndex.byEmployeeDate.get(toEmployeeDateKey(record.employeeId, record.workDate)) || [];

  if (relevantRequests.length === 0) {
    return {
      hasApprovedRequest: false,
      approvedRequestIds: [],
      rawAttendanceHours,
      approvedRequestHours: 0,
      approvedWorkedHours: 0,
      regularHours: baseRegularHours,
      effectiveHours: 0,
      payableHours: 0,
      compLeaveHours: 0,
    };
  }

  const approvedHours = normalizeApprovedRequestHours(relevantRequests);
  const approvedWorkedHours = Math.min(
    approvedHours.total,
    roundHours(Math.max(0, actualWorkHours - baseRegularHours))
  );
  const isNonWorkingDay = record.overtimeType && record.overtimeType !== 'WEEKDAY';
  const statutoryOvertimeHours = roundHours(
    isNonWorkingDay
      ? actualWorkHours
      : Math.max(0, actualWorkHours - STANDARD_REGULAR_HOURS)
  );
  const effectiveHours = Math.min(
    approvedWorkedHours,
    statutoryOvertimeHours,
    isNonWorkingDay ? approvedWorkedHours : rawAttendanceHours
  );
  const regularHours = isNonWorkingDay
    ? baseRegularHours
    : Math.min(
        STANDARD_REGULAR_HOURS,
        Math.max(0, baseRegularHours + approvedWorkedHours - effectiveHours)
      );
  const payableHours = Math.min(effectiveHours, approvedHours.payable);
  const compLeaveHours = Math.min(
    Math.max(0, effectiveHours - payableHours),
    approvedHours.compLeave
  );

  return {
    hasApprovedRequest: true,
    approvedRequestIds: relevantRequests.map(request => request.id),
    rawAttendanceHours,
    approvedRequestHours: roundHours(approvedHours.total),
    approvedWorkedHours: roundHours(approvedWorkedHours),
    regularHours: roundHours(regularHours),
    effectiveHours: roundHours(effectiveHours),
    payableHours: roundHours(payableHours),
    compLeaveHours: roundHours(compLeaveHours),
  };
}
