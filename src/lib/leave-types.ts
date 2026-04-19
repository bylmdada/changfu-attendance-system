const LEAVE_TYPE_ALIASES: Record<string, string> = {
  ANNUAL_LEAVE: 'ANNUAL',
  SICK_LEAVE: 'SICK',
};

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  BEREAVEMENT: '喪假',
  PRENATAL_CHECKUP: '產檢假',
  ANNUAL: '特休假',
  COMPENSATORY: '補休',
  SICK: '病假',
  PERSONAL: '事假',
  MARRIAGE: '婚假',
  UNPAID_LEAVE: '留職停薪',
  OCCUPATIONAL_INJURY: '公傷假',
  MATERNITY: '產假',
  BREASTFEEDING: '哺乳假',
  PATERNITY_CHECKUP: '陪產檢及陪產假',
  MISCARRIAGE: '流產假',
  OFFICIAL: '公假',
  MILITARY_SERVICE: '公假(教召)',
  FAMILY_CARE: '家庭照顧假',
  MENSTRUAL: '生理假',
};

export function normalizeLeaveTypeCode(leaveType?: string | null): string {
  if (!leaveType) {
    return '';
  }

  return LEAVE_TYPE_ALIASES[leaveType] ?? leaveType;
}

export function isAnnualLeaveType(leaveType?: string | null): boolean {
  return normalizeLeaveTypeCode(leaveType) === 'ANNUAL';
}

export function getLeaveTypeLabel(leaveType?: string | null): string {
  const normalizedLeaveType = normalizeLeaveTypeCode(leaveType);
  return LEAVE_TYPE_LABELS[normalizedLeaveType] ?? normalizedLeaveType;
}
