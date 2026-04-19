import { prisma } from '@/lib/database';

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
  return prisma.scheduleMonthlyRelease.findFirst({
    where: {
      yearMonth,
      status: 'PUBLISHED',
      OR: [
        { department: null },
        { department: department || '' }
      ]
    },
    orderBy: { publishedAt: 'desc' }
  });
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
  
  const yearMonth = `${clockDate.getFullYear()}-${(clockDate.getMonth() + 1).toString().padStart(2, '0')}`;

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
  if (confirmation.version < release.version) {
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
  
  if (!settings.enabled || !settings.enableReminder) {
    return { sent: 0, errors: 0 };
  }

  let sent = 0;
  let errors = 0;

  const [year, month] = yearMonth.split('-');
  const deadlineStr = deadline 
    ? deadline.toLocaleDateString('zh-TW') 
    : `${year}年${parseInt(month)}月底`;

  for (const employeeId of employeeIds) {
    try {
      await prisma.notification.create({
        data: {
          employeeId,
          type: 'SCHEDULE_PUBLISH',
          title: `📅 ${year}年${parseInt(month)}月班表已發布`,
          message: `您的${parseInt(month)}月份班表已發布，請於${deadlineStr}前至「個人班表查詢」頁面確認。`,
          data: JSON.stringify({ yearMonth, deadline: deadline?.toISOString() })
        }
      });
      sent++;
    } catch (error) {
      console.error(`發送通知給員工 ${employeeId} 失敗:`, error);
      errors++;
    }
  }

  return { sent, errors };
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
  const release = await prisma.scheduleMonthlyRelease.findFirst({
    where: {
      yearMonth,
      status: 'PUBLISHED',
      ...(department ? { department } : { department: null })
    }
  });

  if (!release) {
    return { sent: 0, pending: 0, errors: 0 };
  }

  // 查詢所有應確認的員工
  const employees = await prisma.employee.findMany({
    where: {
      isActive: true,
      ...(department ? { department } : {})
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

  let sent = 0;
  let errors = 0;

  for (const emp of unconfirmedEmployees) {
    try {
      await prisma.notification.create({
        data: {
          employeeId: emp.id,
          type: 'SCHEDULE_REMINDER',
          title: `⏰ 班表確認提醒`,
          message: `您尚未確認${parseInt(month)}月份班表，請於${deadlineStr}前至「個人班表查詢」頁面完成確認。`,
          data: JSON.stringify({ yearMonth, releaseId: release.id })
        }
      });
      sent++;
    } catch (error) {
      console.error(`發送提醒給員工 ${emp.id} 失敗:`, error);
      errors++;
    }
  }

  return { sent, pending: unconfirmedEmployees.length, errors };
}

/**
 * 取得未確認員工列表
 */
export async function getUnconfirmedEmployees(
  yearMonth: string,
  department?: string
): Promise<Array<{ id: number; employeeId: string; name: string; department: string | null }>> {
  const release = await prisma.scheduleMonthlyRelease.findFirst({
    where: {
      yearMonth,
      status: 'PUBLISHED',
      ...(department ? { department } : { department: null })
    }
  });

  if (!release) {
    return [];
  }

  const employees = await prisma.employee.findMany({
    where: {
      isActive: true,
      ...(department ? { department } : {})
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
    // 查詢該月份的發布記錄
    const release = await prisma.scheduleMonthlyRelease.findFirst({
      where: { yearMonth }
    });

    if (!release) {
      // 沒有發布記錄，不需要失效
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
      // 發送重新確認通知
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true }
      });

      const [, month] = yearMonth.split('-');
      
      await prisma.notification.create({
        data: {
          employeeId,
          type: 'SCHEDULE_RECONFIRM',
          title: '🔄 班表異動通知',
          message: `您${parseInt(month)}月份的班表已異動，請重新至「我的班表」頁面確認。`,
          data: JSON.stringify({ yearMonth, reason: 'schedule_changed' })
        }
      });

      return { invalidated: true, message: `已通知 ${employee?.name || '員工'} 重新確認班表` };
    }

    return { invalidated: false, message: '無需更新確認狀態' };
  } catch (error) {
    console.error('失效確認記錄失敗:', error);
    return { invalidated: false, message: '操作失敗' };
  }
}
