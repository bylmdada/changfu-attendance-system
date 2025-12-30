/**
 * 📊 加班時數警示系統
 * 
 * 監控員工加班時數，當超過閾值時自動通知主管和 HR：
 * - 40 小時/月：黃色警示（提醒注意）
 * - 46 小時/月：紅色警示（違反法規）
 * 
 * @created 2024-12-23
 */

import { prisma } from '@/lib/database';
import { systemLogger } from '@/lib/logger';

// 加班閾值設定
export const OVERTIME_THRESHOLDS = {
  WARNING: 40,    // 警示閾值（小時/月）
  LEGAL_LIMIT: 46 // 法定上限（小時/月）
};

// 警示等級
export type OvertimeAlertLevel = 'NONE' | 'WARNING' | 'CRITICAL';

// 員工加班狀態
export interface EmployeeOvertimeStatus {
  employeeId: number;
  employeeCode: string;
  name: string;
  department: string | null;
  totalHours: number;
  alertLevel: OvertimeAlertLevel;
  supervisorId?: number;
}

// 警示通知結果
export interface OvertimeWarningResult {
  scannedEmployees: number;
  warningCount: number;
  criticalCount: number;
  notificationsSent: number;
  details: EmployeeOvertimeStatus[];
}

/**
 * 計算員工當月加班時數
 */
export async function getEmployeeMonthlyOvertime(
  employeeId: number,
  year: number,
  month: number
): Promise<number> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const overtimeRecords = await prisma.overtimeRequest.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      overtimeDate: {
        gte: startDate,
        lte: endDate
      }
    },
    select: {
      totalHours: true
    }
  });

  return overtimeRecords.reduce((sum, record) => sum + record.totalHours, 0);
}

/**
 * 檢查單一員工的加班狀態
 */
export async function checkEmployeeOvertimeStatus(
  employeeId: number,
  year: number,
  month: number
): Promise<EmployeeOvertimeStatus | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      employeeId: true,
      name: true,
      department: true
    }
  });

  if (!employee) {
    return null;
  }

  const totalHours = await getEmployeeMonthlyOvertime(employeeId, year, month);
  
  let alertLevel: OvertimeAlertLevel = 'NONE';
  if (totalHours >= OVERTIME_THRESHOLDS.LEGAL_LIMIT) {
    alertLevel = 'CRITICAL';
  } else if (totalHours >= OVERTIME_THRESHOLDS.WARNING) {
    alertLevel = 'WARNING';
  }

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeId,
    name: employee.name,
    department: employee.department,
    totalHours,
    alertLevel
  };
}

/**
 * 掃描所有員工的加班狀態
 */
export async function scanAllEmployeesOvertime(
  year?: number,
  month?: number
): Promise<OvertimeWarningResult> {
  const now = new Date();
  const targetYear = year || now.getFullYear();
  const targetMonth = month || (now.getMonth() + 1);

  // 取得所有在職員工
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: {
      id: true,
      employeeId: true,
      name: true,
      department: true
    }
  });

  const result: OvertimeWarningResult = {
    scannedEmployees: employees.length,
    warningCount: 0,
    criticalCount: 0,
    notificationsSent: 0,
    details: []
  };

  for (const employee of employees) {
    const totalHours = await getEmployeeMonthlyOvertime(employee.id, targetYear, targetMonth);
    
    let alertLevel: OvertimeAlertLevel = 'NONE';
    if (totalHours >= OVERTIME_THRESHOLDS.LEGAL_LIMIT) {
      alertLevel = 'CRITICAL';
      result.criticalCount++;
    } else if (totalHours >= OVERTIME_THRESHOLDS.WARNING) {
      alertLevel = 'WARNING';
      result.warningCount++;
    }

    if (alertLevel !== 'NONE') {
      result.details.push({
        employeeId: employee.id,
        employeeCode: employee.employeeId,
        name: employee.name,
        department: employee.department,
        totalHours,
        alertLevel
      });
    }
  }

  return result;
}

/**
 * 發送加班超限通知
 */
export async function sendOvertimeWarningNotifications(
  warningResult: OvertimeWarningResult,
  year: number,
  month: number
): Promise<number> {
  let notificationsSent = 0;

  // 取得 HR 用戶列表
  const hrUsers = await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'HR'] },
      isActive: true
    },
    select: {
      id: true,
      employeeId: true
    }
  });

  for (const detail of warningResult.details) {
    const alertEmoji = detail.alertLevel === 'CRITICAL' ? '🔴' : '🟡';
    const alertText = detail.alertLevel === 'CRITICAL' ? '超過法定上限' : '接近警戒線';
    
    const title = `${alertEmoji} 加班時數警示：${detail.name}`;
    const message = `員工 ${detail.name}（${detail.employeeCode}）本月加班時數已達 ${detail.totalHours.toFixed(1)} 小時，${alertText}（${detail.alertLevel === 'CRITICAL' ? '法定上限 46 小時' : '警戒線 40 小時'}）。`;

    // 發送給該員工
    try {
      await prisma.notification.create({
        data: {
          employeeId: detail.employeeId,
          type: 'OVERTIME_WARNING',
          title,
          message,
          data: JSON.stringify({
            year,
            month,
            totalHours: detail.totalHours,
            alertLevel: detail.alertLevel,
            threshold: detail.alertLevel === 'CRITICAL' 
              ? OVERTIME_THRESHOLDS.LEGAL_LIMIT 
              : OVERTIME_THRESHOLDS.WARNING
          })
        }
      });
      notificationsSent++;
    } catch (error) {
      systemLogger.error(`無法發送加班警示給員工 ${detail.employeeId}`, {
        error: error instanceof Error ? error : new Error(String(error)),
        context: { employeeId: detail.employeeId }
      });
    }

    // 發送給 HR
    for (const hr of hrUsers) {
      if (hr.employeeId && hr.employeeId !== detail.employeeId) {
        try {
          await prisma.notification.create({
            data: {
              employeeId: hr.employeeId,
              type: 'OVERTIME_WARNING',
              title: `[HR通知] ${title}`,
              message,
              data: JSON.stringify({
                year,
                month,
                targetEmployeeId: detail.employeeId,
                targetEmployeeName: detail.name,
                totalHours: detail.totalHours,
                alertLevel: detail.alertLevel
              })
            }
          });
          notificationsSent++;
        } catch {
          // 忽略重複通知錯誤
        }
      }
    }
  }

  // 記錄掃描日誌
  if (warningResult.warningCount > 0 || warningResult.criticalCount > 0) {
    systemLogger.warn(`加班警示掃描完成：${warningResult.criticalCount} 人超過法定上限，${warningResult.warningCount} 人達警戒線`, {
      context: {
        year,
        month,
        warningCount: warningResult.warningCount,
        criticalCount: warningResult.criticalCount,
        notificationsSent
      }
    });
  }

  return notificationsSent;
}

/**
 * 執行完整加班警示檢查流程
 */
export async function runOvertimeWarningCheck(
  year?: number,
  month?: number
): Promise<OvertimeWarningResult> {
  const now = new Date();
  const targetYear = year || now.getFullYear();
  const targetMonth = month || (now.getMonth() + 1);

  systemLogger.info(`開始執行加班警示檢查: ${targetYear}年${targetMonth}月`, {
    context: { year: targetYear, month: targetMonth }
  });

  // 掃描所有員工
  const result = await scanAllEmployeesOvertime(targetYear, targetMonth);

  // 發送通知
  if (result.warningCount > 0 || result.criticalCount > 0) {
    result.notificationsSent = await sendOvertimeWarningNotifications(
      result,
      targetYear,
      targetMonth
    );
  }

  systemLogger.info(`加班警示檢查完成`, {
    context: {
      scannedEmployees: result.scannedEmployees,
      warningCount: result.warningCount,
      criticalCount: result.criticalCount,
      notificationsSent: result.notificationsSent
    }
  });

  return result;
}

/**
 * 取得加班統計摘要（含警示標記）
 */
export async function getOvertimeSummaryWithAlerts(
  year: number,
  month: number
): Promise<{
  employees: EmployeeOvertimeStatus[];
  summary: {
    totalEmployees: number;
    warningCount: number;
    criticalCount: number;
    averageHours: number;
  };
}> {
  const result = await scanAllEmployeesOvertime(year, month);
  
  // 取得所有有加班記錄的員工
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const overtimeByEmployee = await prisma.overtimeRequest.groupBy({
    by: ['employeeId'],
    where: {
      status: 'APPROVED',
      overtimeDate: {
        gte: startDate,
        lte: endDate
      }
    },
    _sum: {
      totalHours: true
    }
  });

  const employeeIds = overtimeByEmployee.map(o => o.employeeId);
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: {
      id: true,
      employeeId: true,
      name: true,
      department: true
    }
  });

  const employeeMap = new Map(employees.map(e => [e.id, e]));
  
  const allStatuses: EmployeeOvertimeStatus[] = overtimeByEmployee.map(o => {
    const employee = employeeMap.get(o.employeeId);
    const totalHours = o._sum.totalHours || 0;
    let alertLevel: OvertimeAlertLevel = 'NONE';
    
    if (totalHours >= OVERTIME_THRESHOLDS.LEGAL_LIMIT) {
      alertLevel = 'CRITICAL';
    } else if (totalHours >= OVERTIME_THRESHOLDS.WARNING) {
      alertLevel = 'WARNING';
    }

    return {
      employeeId: o.employeeId,
      employeeCode: employee?.employeeId || '',
      name: employee?.name || 'Unknown',
      department: employee?.department || null,
      totalHours,
      alertLevel
    };
  }).sort((a, b) => b.totalHours - a.totalHours);

  const totalHours = allStatuses.reduce((sum, s) => sum + s.totalHours, 0);

  return {
    employees: allStatuses,
    summary: {
      totalEmployees: allStatuses.length,
      warningCount: result.warningCount,
      criticalCount: result.criticalCount,
      averageHours: allStatuses.length > 0 ? totalHours / allStatuses.length : 0
    }
  };
}
