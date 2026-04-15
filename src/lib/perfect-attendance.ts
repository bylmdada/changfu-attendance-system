/**
 * 全勤獎金計算模組
 * 
 * 業務規則：
 * - 僅限日照中心部門
 * - 全勤獎金金額：2,000 元
 * - 不影響全勤的假別：婚假、喪假、公假、公傷病假、產假、陪產假、產檢假
 * - 影響全勤（按比例扣發）：遲到、早退、曠職、事假、普通病假
 * - 計算公式：全勤獎金 = 基本金額 × (實際出勤日 / 應出勤日)
 */

import { prisma } from './database';
import { safeParseSystemSettingsValue } from './system-settings-json';

// 全勤獎金設定
export interface PerfectAttendanceConfig {
  enabled: boolean;
  amount: number;
  applicableDepartments: string[];
  excludedLeaveTypes: string[]; // 不影響全勤的假別
}

// 全勤獎金計算結果
export interface PerfectAttendanceResult {
  eligible: boolean;
  baseAmount: number;
  actualAmount: number;
  attendanceRatio: number;
  workDays: number;
  actualWorkDays: number;
  lateCount: number;
  earlyLeaveCount: number;
  absentCount: number;
  affectedLeavedays: number;
  details: string;
}

// 預設設定
export const DEFAULT_PERFECT_ATTENDANCE_CONFIG: PerfectAttendanceConfig = {
  enabled: true,
  amount: 2000,
  applicableDepartments: ['日照中心'],
  excludedLeaveTypes: [
    'MARRIAGE',      // 婚假
    'FUNERAL',       // 喪假
    'PUBLIC',        // 公假
    'WORK_INJURY',   // 公傷病假
    'MATERNITY',     // 產假
    'PATERNITY',     // 陪產假
    'PRENATAL',      // 產檢假
    'MENSTRUAL',     // 生理假
    'FAMILY_CARE',   // 家庭照顧假
  ]
};

function normalizePerfectAttendanceConfig(
  config: Partial<PerfectAttendanceConfig> | null | undefined
): PerfectAttendanceConfig {
  return {
    enabled: typeof config?.enabled === 'boolean' ? config.enabled : DEFAULT_PERFECT_ATTENDANCE_CONFIG.enabled,
    amount:
      typeof config?.amount === 'number' && Number.isFinite(config.amount)
        ? config.amount
        : DEFAULT_PERFECT_ATTENDANCE_CONFIG.amount,
    applicableDepartments: Array.isArray(config?.applicableDepartments)
      ? config.applicableDepartments
      : DEFAULT_PERFECT_ATTENDANCE_CONFIG.applicableDepartments,
    excludedLeaveTypes: Array.isArray(config?.excludedLeaveTypes)
      ? config.excludedLeaveTypes
      : DEFAULT_PERFECT_ATTENDANCE_CONFIG.excludedLeaveTypes,
  };
}

// 影響全勤的假別
const AFFECTED_LEAVE_TYPES = [
  'PERSONAL',    // 事假
  'SICK',        // 普通病假
];

/**
 * 取得全勤獎金設定
 */
export async function getPerfectAttendanceConfig(): Promise<PerfectAttendanceConfig> {
  try {
    const setting = await prisma.systemSettings.findFirst({
      where: { key: 'perfectAttendanceBonus' }
    });

    if (setting?.value) {
      const parsedValue = safeParseSystemSettingsValue<Partial<PerfectAttendanceConfig>>(
        setting.value as string,
        DEFAULT_PERFECT_ATTENDANCE_CONFIG,
        'perfectAttendanceBonus'
      );

      return normalizePerfectAttendanceConfig(parsedValue);
    }
  } catch (error) {
    console.warn('讀取全勤獎金設定失敗，使用預設值:', error);
  }

  return normalizePerfectAttendanceConfig(DEFAULT_PERFECT_ATTENDANCE_CONFIG);
}

/**
 * 儲存全勤獎金設定
 */
export async function savePerfectAttendanceConfig(config: PerfectAttendanceConfig): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { key: 'perfectAttendanceBonus' },
    update: {
      value: JSON.stringify(config)
    },
    create: {
      key: 'perfectAttendanceBonus',
      value: JSON.stringify(config),
      description: '全勤獎金設定'
    }
  });
}

/**
 * 計算員工全勤獎金
 * 
 * @param employeeId 員工ID
 * @param year 年份
 * @param month 月份
 * @returns 全勤獎金計算結果
 */
export async function calculatePerfectAttendanceBonus(
  employeeId: number,
  year: number,
  month: number
): Promise<PerfectAttendanceResult> {
  const config = await getPerfectAttendanceConfig();
  
  // 取得員工資訊
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId }
  });

  if (!employee) {
    return {
      eligible: false,
      baseAmount: 0,
      actualAmount: 0,
      attendanceRatio: 0,
      workDays: 0,
      actualWorkDays: 0,
      lateCount: 0,
      earlyLeaveCount: 0,
      absentCount: 0,
      affectedLeavedays: 0,
      details: '找不到員工資料'
    };
  }

  // 檢查是否為適用部門
  if (!employee.department || !config.applicableDepartments.includes(employee.department)) {
    return {
      eligible: false,
      baseAmount: 0,
      actualAmount: 0,
      attendanceRatio: 0,
      workDays: 0,
      actualWorkDays: 0,
      lateCount: 0,
      earlyLeaveCount: 0,
      absentCount: 0,
      affectedLeavedays: 0,
      details: `${employee.department || '未設定部門'} 不適用全勤獎金`
    };
  }

  // 計算該月份的工作日
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  
  // 取得考勤記錄
  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: {
      employeeId,
      workDate: {
        gte: startDate,
        lte: endDate
      }
    }
  });

  // 取得請假記錄
  const leaveRequests = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      OR: [
        {
          startDate: {
            gte: startDate,
            lte: endDate
          }
        },
        {
          endDate: {
            gte: startDate,
            lte: endDate
          }
        }
      ]
    }
  });

  // 計算應出勤日數（排除週末）
  let workDays = 0;
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workDays++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // 統計遲到、早退、曠職次數
  // 注意：目前 AttendanceRecord 沒有 isLate/isEarlyLeave 欄位，
  // 需透過班表比對打卡時間來判斷，此處簡化為只統計曠職
  const lateCount = 0;
  const earlyLeaveCount = 0;
  let absentCount = 0;

  attendanceRecords.forEach(record => {
    // 統計曠職
    if (record.status === 'ABSENT') absentCount++;
    // TODO: 未來可新增遲到/早退判斷邏輯
  });

  // 計算影響全勤的請假天數
  let affectedLeavedays = 0;
  leaveRequests.forEach(leave => {
    if (AFFECTED_LEAVE_TYPES.includes(leave.leaveType)) {
      // 使用 totalDays 欄位
      affectedLeavedays += leave.totalDays;
    }
  });

  // 計算實際出勤日數（扣除遲到、早退、曠職、影響全勤的請假）
  // 每次遲到/早退扣 0.5 天，曠職扣 1 天
  const deductedDays = (lateCount * 0.5) + (earlyLeaveCount * 0.5) + absentCount + affectedLeavedays;
  const actualWorkDays = Math.max(0, workDays - deductedDays);

  // 計算出勤比例
  const attendanceRatio = workDays > 0 ? actualWorkDays / workDays : 0;

  // 計算全勤獎金
  const actualAmount = Math.round(config.amount * attendanceRatio);

  // 判斷是否完全全勤
  const isPerfect = lateCount === 0 && earlyLeaveCount === 0 && absentCount === 0 && affectedLeavedays === 0;

  // 組合說明
  let details = '';
  if (isPerfect) {
    details = '完全全勤，獲得全額獎金';
  } else {
    const deductions: string[] = [];
    if (lateCount > 0) deductions.push(`遲到${lateCount}次`);
    if (earlyLeaveCount > 0) deductions.push(`早退${earlyLeaveCount}次`);
    if (absentCount > 0) deductions.push(`曠職${absentCount}天`);
    if (affectedLeavedays > 0) deductions.push(`請假${affectedLeavedays.toFixed(1)}天`);
    details = `按比例扣發：${deductions.join('、')}，出勤比例 ${(attendanceRatio * 100).toFixed(1)}%`;
  }

  return {
    eligible: config.enabled,
    baseAmount: config.amount,
    actualAmount,
    attendanceRatio,
    workDays,
    actualWorkDays,
    lateCount,
    earlyLeaveCount,
    absentCount,
    affectedLeavedays,
    details
  };
}

/**
 * 批量計算全勤獎金
 */
export async function batchCalculatePerfectAttendanceBonus(
  year: number,
  month: number
): Promise<Map<number, PerfectAttendanceResult>> {
  const config = await getPerfectAttendanceConfig();
  
  // 只查詢適用部門的員工
  const employees = await prisma.employee.findMany({
    where: {
      isActive: true,
      department: {
        in: config.applicableDepartments
      }
    }
  });

  const results = new Map<number, PerfectAttendanceResult>();

  for (const employee of employees) {
    const result = await calculatePerfectAttendanceBonus(employee.id, year, month);
    results.set(employee.id, result);
  }

  return results;
}
