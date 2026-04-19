/**
 * 假別規則驗證輔助函數
 * 
 * 用於驗證請假申請是否符合系統設定的假別規則
 */

import { prisma } from '@/lib/database';
import {
  DEFAULT_LEAVE_RULES_SETTINGS,
  type LeaveRulesSettingsValues,
} from '@/lib/leave-rules-config-defaults';

export type LeaveRulesConfig = LeaveRulesSettingsValues;

export interface LeaveValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
  rulesApplied?: string[];
}

/**
 * 取得假別規則設定
 */
export async function getLeaveRulesConfig(): Promise<LeaveRulesConfig> {
  try {
    const config = await prisma.leaveRulesConfig.findFirst({
      where: { isActive: true },
      orderBy: { effectiveDate: 'desc' }
    });

    if (config) {
      return {
        parentalLeaveFlexible: config.parentalLeaveFlexible,
        parentalLeaveMaxDays: config.parentalLeaveMaxDays,
        parentalLeaveCombinedMax: config.parentalLeaveCombinedMax,
        familyCareLeaveMaxDays: config.familyCareLeaveMaxDays,
        familyCareHourlyEnabled: config.familyCareHourlyEnabled,
        familyCareHourlyMaxHours: config.familyCareHourlyMaxHours,
        familyCareNoDeductAttendance: config.familyCareNoDeductAttendance,
        sickLeaveAnnualMax: config.sickLeaveAnnualMax,
        sickLeaveNoDeductDays: config.sickLeaveNoDeductDays,
        sickLeaveHalfPay: config.sickLeaveHalfPay,
        annualLeaveRollover: config.annualLeaveRollover,
        annualLeaveRolloverMax: config.annualLeaveRolloverMax,
        compLeaveRollover: config.compLeaveRollover,
        compLeaveRolloverMax: config.compLeaveRolloverMax,
        compLeaveExpiryMonths: config.compLeaveExpiryMonths,
      };
    }

    return DEFAULT_LEAVE_RULES_SETTINGS;
  } catch (error) {
    console.error('取得假別規則設定失敗:', error);
    return DEFAULT_LEAVE_RULES_SETTINGS;
  }
}

/**
 * 驗證請假申請是否符合假別規則
 */
export async function validateLeaveRequest(
  employeeId: number,
  leaveType: string,
  totalDays: number,
  year: number
): Promise<LeaveValidationResult> {
  const config = await getLeaveRulesConfig();
  const rulesApplied: string[] = [];

  // 取得該員工年度已使用的請假天數
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31);

  const usedLeaves = await prisma.leaveRequest.aggregate({
    where: {
      employeeId,
      leaveType,
      status: 'APPROVED',
      startDate: {
        gte: startOfYear,
        lte: endOfYear
      }
    },
    _sum: {
      totalDays: true
    }
  });

  const usedDays = usedLeaves._sum.totalDays || 0;
  const requestedTotal = usedDays + totalDays;

  // 根據假別類型驗證
  switch (leaveType) {
    case 'SICK':
      // 病假年度上限驗證
      if (requestedTotal > config.sickLeaveAnnualMax) {
        return {
          valid: false,
          error: `病假年度上限為 ${config.sickLeaveAnnualMax} 天，您已使用 ${usedDays} 天，本次申請 ${totalDays} 天將超出上限`,
          rulesApplied: ['sickLeaveAnnualMax']
        };
      }
      rulesApplied.push('sickLeaveAnnualMax');
      break;

    case 'FAMILY_CARE':
      // 家庭照顧假上限驗證
      if (requestedTotal > config.familyCareLeaveMaxDays) {
        if (config.familyCareHourlyEnabled) {
          return {
            valid: false,
            error: `家庭照顧假年度上限為 ${config.familyCareLeaveMaxDays} 天，您已使用 ${usedDays} 天。超出部分請改以事假另行申請（系統不會自動轉換，年度最多 ${config.familyCareHourlyMaxHours} 小時）`,
            rulesApplied: ['familyCareLeaveMaxDays', 'familyCareHourlyEnabled', 'familyCareHourlyMaxHours']
          };
        }
        return {
          valid: false,
          error: `家庭照顧假年度上限為 ${config.familyCareLeaveMaxDays} 天，您已使用 ${usedDays} 天`,
          rulesApplied: ['familyCareLeaveMaxDays']
        };
      }
      rulesApplied.push('familyCareLeaveMaxDays');
      break;

    case 'PARENTAL':
      // 育嬰留停上限驗證
      if (requestedTotal > config.parentalLeaveMaxDays) {
        return {
          valid: false,
          error: `育嬰留停個人上限為 ${config.parentalLeaveMaxDays} 天，您已使用 ${usedDays} 天`,
          rulesApplied: ['parentalLeaveMaxDays']
        };
      }
      // 單日申請檢查
      if (!config.parentalLeaveFlexible && totalDays < 1) {
        return {
          valid: false,
          error: '育嬰留停不允許單日申請，請至少申請 1 天',
          rulesApplied: ['parentalLeaveFlexible']
        };
      }
      rulesApplied.push('parentalLeaveMaxDays', 'parentalLeaveFlexible');
      break;

    default:
      // 其他假別不做特別限制
      break;
  }

  return {
    valid: true,
    rulesApplied
  };
}

/**
 * 檢查病假是否影響全勤
 */
export async function checkSickLeaveAffectsAttendance(
  employeeId: number,
  year: number
): Promise<{ affects: boolean; usedDays: number; threshold: number }> {
  const config = await getLeaveRulesConfig();

  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31);

  const usedLeaves = await prisma.leaveRequest.aggregate({
    where: {
      employeeId,
      leaveType: 'SICK',
      status: 'APPROVED',
      startDate: {
        gte: startOfYear,
        lte: endOfYear
      }
    },
    _sum: {
      totalDays: true
    }
  });

  const usedDays = usedLeaves._sum.totalDays || 0;

  return {
    affects: usedDays > config.sickLeaveNoDeductDays,
    usedDays,
    threshold: config.sickLeaveNoDeductDays
  };
}

/**
 * 檢查家庭照顧假是否影響全勤
 */
export async function checkFamilyCareAffectsAttendance(): Promise<boolean> {
  const config = await getLeaveRulesConfig();
  return !config.familyCareNoDeductAttendance;
}
