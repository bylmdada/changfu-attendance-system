export interface LeaveRulesSettingsValues {
  parentalLeaveFlexible: boolean;
  parentalLeaveMaxDays: number;
  parentalLeaveCombinedMax: number;
  familyCareLeaveMaxDays: number;
  familyCareHourlyEnabled: boolean;
  familyCareHourlyMaxHours: number;
  familyCareNoDeductAttendance: boolean;
  sickLeaveAnnualMax: number;
  sickLeaveNoDeductDays: number;
  sickLeaveHalfPay: boolean;
  annualLeaveRollover: boolean;
  annualLeaveRolloverMax: number;
  compLeaveRollover: boolean;
  compLeaveRolloverMax: number;
  compLeaveExpiryMonths: number;
}

export const DEFAULT_LEAVE_RULES_SETTINGS: LeaveRulesSettingsValues = {
  parentalLeaveFlexible: true,
  parentalLeaveMaxDays: 30,
  parentalLeaveCombinedMax: 60,
  familyCareLeaveMaxDays: 7,
  familyCareHourlyEnabled: true,
  familyCareHourlyMaxHours: 56,
  familyCareNoDeductAttendance: true,
  sickLeaveAnnualMax: 30,
  sickLeaveNoDeductDays: 10,
  sickLeaveHalfPay: true,
  annualLeaveRollover: false,
  annualLeaveRolloverMax: 0,
  compLeaveRollover: false,
  compLeaveRolloverMax: 0,
  compLeaveExpiryMonths: 6,
};
