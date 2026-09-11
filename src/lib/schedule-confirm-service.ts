import { prisma } from '@/lib/database';
import { sendNotification } from '@/lib/realtime-notifications';
import {
  getScheduleReleaseDepartmentFilters,
  pickApplicableScheduleRelease,
} from '@/lib/schedule-confirmation-status';
import { getTaiwanYearMonth } from '@/lib/timezone';

/**
 * 班表確認機制設定服務
 */

const SETTING_KEYS = {
  ENABLED: 'scheduleConfirm.enabled',
  BLOCK_CLOCK: 'scheduleConfirm.blockClock',
  ENABLE_REMINDER: 'scheduleConfirm.enableReminder'
};

const DEFAULT_SETTINGS: Record<string, boolean> = {
  [SETTING_KEYS.ENABLED]: false,
  [SETTING_KEYS.BLOCK_CLOCK]: false,
  [SETTING_KEYS.ENABLE_REMINDER]: false
};

export interface ScheduleConfirmSettings {
  enabled: boolean;
  blockClock: boolean;
  enableReminder: boolean;
}

async function findApplicablePublishedRelease(yearMonth: string, department?: string | null) {
  const releases = await prisma.scheduleMonthlyRelease.findMany({
    where: {
      yearMonth,
      status: 'PUBLISHED',
      OR: getScheduleReleaseDepartmentFilters(department),
    },
    orderBy: { publishedAt: 'desc' },
  });

  return pickApplicableScheduleRelease(releases, department);
}

/**
 * 取得班表確認機制設定
 */
export async function getScheduleConfirmSettings(): Promise<ScheduleConfirmSettings> {
  const settings = await prisma.systemSettings.findMany({
    where: {
      key: { in: Object.values(SETTING_KEYS) }
    }
  });

  const result: Record<string, boolean> = { ...DEFAULT_SETTINGS };
  
  settings.forEach(s => {
    try {
      result[s.key] = JSON.parse(s.value);
    } catch {
      result[s.key] = DEFAULT_SETTINGS[s.key] ?? false;
    }
  });

  return {
    enabled: result[SETTING_KEYS.ENABLED],
    blockClock: result[SETTING_KEYS.BLOCK_CLOCK],
    enableReminder: result[SETTING_KEYS.ENABLE_REMINDER]
  };
}

/**
 * 檢查員工是否可以打卡（基於班表確認機制）
 */
export async function canEmployeeClockIn(employeeId: number, clockDate: Date): Promise<{ allowed: boolean; reason?: string }> {
  const settings = await getScheduleConfirmSettings();
  
  // 功能未開啟，允許打卡
  if (!settings.enabled || !settings.blockClock) {
    return { allowed: true };
  }
  
  const yearMonth = getTaiwanYearMonth(clockDate);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      department: true
    }
  });

  if (!employee) {
    return {
      allowed: false,
      reason: '找不到員工資料'
    };
  }

  const schedule = await prisma.schedule.findFirst({
    where: { employeeId, workDate: { startsWith: `${yearMonth}-` } },
    select: { id: true },
  });
  if (!schedule) {
    return { allowed: true };
  }

  const release = await findApplicablePublishedRelease(yearMonth, employee.department);
  if (!release) {
    return {
      allowed: false,
      reason: '本月班表尚未發布，請聯繫排班管理員'
    };
  }

  const confirmation = await prisma.scheduleConfirmation.findUnique({
    where: {
      employeeId_releaseId: {
        employeeId,
        releaseId: release.id
      }
    }
  });
  
  if (!confirmation) {
    return {
      allowed: false,
      reason: '您尚未確認本月班表，請先至「個人班表查詢」頁面確認'
    };
  }
  
  // 檢查版本是否匹配
  if (!confirmation.isValid || confirmation.version < release.version) {
    return {
      allowed: false,
      reason: '班表已更新，請重新確認後再打卡'
    };
  }
  
  return { allowed: true };
}

/**
 * 發送班表發布通知給指定員工
 */
export async function sendSchedulePublishNotification(
  yearMonth: string,
  employeeIds: number[],
  deadline?: Date
): Promise<{ sent: number; errors: number }> {
  const settings = await getScheduleConfirmSettings();
  
  if (!settings.enabled || employeeIds.length === 0) {
    return { sent: 0, errors: 0 };
  }

  const [year, month] = yearMonth.split('-');
  const deadlineStr = deadline 
    ? deadline.toLocaleDateString('zh-TW') 
    : `${year}年${parseInt(month)}月底`;

  try {
    await sendNotification({
      type: 'SCHEDULE_UPDATE',
      priority: 'NORMAL',
      channels: ['IN_APP'],
      title: `${year}年${parseInt(month)}月班表已發布`,
      message: `您的${parseInt(month)}月份班表已發布，請於${deadlineStr}前至「個人班表查詢」頁面確認。`,
      data: { yearMonth, deadline: deadline?.toISOString(), path: '/my-schedule' },
      targetUsers: employeeIds.map(String),
      createdBy: 'SYSTEM',
    });
    return { sent: employeeIds.length, errors: 0 };
  } catch (error) {
    console.error('發送班表發布通知失敗:', error);
    return { sent: 0, errors: employeeIds.length };
  }
}

/**
 * 發送確認提醒給未確認的員工
 */
export async function sendReminderToUnconfirmed(
  yearMonth: string,
  department?: string
): Promise<{ sent: number; pending: number; errors: number }> {
  const settings = await getScheduleConfirmSettings();
  
  if (!settings.enabled || !settings.enableReminder) {
    return { sent: 0, pending: 0, errors: 0 };
  }

  // 查詢發布記錄
  const release = await findApplicablePublishedRelease(yearMonth, department);

  if (!release) {
    return { sent: 0, pending: 0, errors: 0 };
  }

  // 查詢所有應確認的員工
  const employees = await prisma.employee.findMany({
    where: {
      isActive: true,
      ...(department ? { department } : {}),
      schedules: { some: { workDate: { startsWith: `${yearMonth}-` } } },
    },
    select: { id: true, name: true }
  });

  // 查詢已確認的員工
  const confirmations = await prisma.scheduleConfirmation.findMany({
    where: {
      releaseId: release.id,
      isValid: true,
      version: release.version
    },
    select: { employeeId: true }
  });

  const confirmedIds = new Set(confirmations.map(c => c.employeeId));
  const unconfirmedEmployees = employees.filter(e => !confirmedIds.has(e.id));

  const [year, month] = yearMonth.split('-');
  const deadlineStr = release.deadline 
    ? release.deadline.toLocaleDateString('zh-TW')
    : `${year}年${parseInt(month)}月底`;

  if (unconfirmedEmployees.length === 0) {
    return { sent: 0, pending: 0, errors: 0 };
  }

  try {
    await sendNotification({
      type: 'SCHEDULE_UPDATE',
      priority: 'HIGH',
      channels: ['IN_APP'],
      title: '班表確認提醒',
      message: `您尚未確認${parseInt(month)}月份班表，請於${deadlineStr}前至「個人班表查詢」頁面完成確認。`,
      data: { yearMonth, releaseId: release.id, path: '/my-schedule' },
      targetUsers: unconfirmedEmployees.map((employee) => String(employee.id)),
      createdBy: 'SYSTEM',
    });
    return { sent: unconfirmedEmployees.length, pending: unconfirmedEmployees.length, errors: 0 };
  } catch (error) {
    console.error('發送班表確認提醒失敗:', error);
    return { sent: 0, pending: unconfirmedEmployees.length, errors: unconfirmedEmployees.length };
  }
}

/**
 * 取得未確認員工列表
 */
export async function getUnconfirmedEmployees(
  yearMonth: string,
  department?: string
): Promise<Array<{ id: number; employeeId: string; name: string; department: string | null }>> {
  const release = await findApplicablePublishedRelease(yearMonth, department);

  if (!release) {
    return [];
  }

  const employees = await prisma.employee.findMany({
    where: {
      isActive: true,
      ...(department ? { department } : {}),
      schedules: { some: { workDate: { startsWith: `${yearMonth}-` } } },
    },
    select: { id: true, employeeId: true, name: true, department: true }
  });

  const confirmations = await prisma.scheduleConfirmation.findMany({
    where: {
      releaseId: release.id,
      isValid: true,
      version: release.version
    },
    select: { employeeId: true }
  });

  const confirmedIds = new Set(confirmations.map(c => c.employeeId));
  return employees.filter(e => !confirmedIds.has(e.id));
}

/**
 * 當班表異動時，使對應員工的確認記錄失效（需重新確認）
 * @param employeeId 員工 ID
 * @param yearMonth 月份 (格式: YYYY-MM)
 */
export async function invalidateConfirmation(
  employeeId: number,
  yearMonth: string
): Promise<{ invalidated: boolean; message?: string }> {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, department: true, name: true }
    });

    if (!employee) {
      return { invalidated: false, message: '找不到員工資料' };
    }

    const release = await findApplicablePublishedRelease(yearMonth, employee.department);

    if (!release) {
      return { invalidated: false, message: '尚無發布記錄' };
    }

    // 僅失效受影響員工的確認狀態，避免連帶使其他員工必須重新確認。
    const updated = await prisma.scheduleConfirmation.updateMany({
      where: {
        employeeId,
        yearMonth,
        releaseId: release.id,
        isValid: true
      },
      data: {
        isValid: false
      }
    });

    if (updated.count > 0) {
      const [, month] = yearMonth.split('-');

      await sendNotification({
        type: 'SCHEDULE_UPDATE',
        priority: 'HIGH',
        channels: ['IN_APP'],
        title: '班表異動通知',
        message: `您${parseInt(month)}月份的班表已異動，請重新至「我的班表」頁面確認。`,
        data: { yearMonth, reason: 'schedule_changed', path: '/my-schedule' },
        targetUsers: [String(employeeId)],
        createdBy: 'SYSTEM',
      });

      return { invalidated: true, message: `已通知 ${employee?.name || '員工'} 重新確認班表` };
    }

    return { invalidated: false, message: '無需更新確認狀態' };
  } catch (error) {
    console.error('失效確認記錄失敗:', error);
    throw error;
  }
}
