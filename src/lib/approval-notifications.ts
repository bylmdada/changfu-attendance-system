/**
 * 審核提醒服務
 * 發送審核相關通知給審核者和申請人
 */

import { prisma } from '@/lib/database';
import { sendNotification } from '@/lib/realtime-notifications';

// 申請類型名稱對照
const REQUEST_TYPE_NAMES: Record<string, string> = {
  SHIFT_CHANGE: '調班申請',
  SHIFT_SWAP: '換班申請',
  MISSED_CLOCK: '補打卡申請',
  LEAVE: '請假申請',
  OVERTIME: '加班申請',
  PURCHASE: '請購申請',
  RESIGNATION: '離職申請',
  PAYROLL_DISPUTE: '薪資異議',
  DEPENDENT_APP: '眷屬申請',
  ANNOUNCEMENT: '公告發布'
};

interface ApprovalInstance {
  id: number;
  requestType: string;
  requestId: number;
  applicantId: number;
  applicantName: string;
  department: string | null;
  currentLevel: number;
  status: string;
  deadlineAt: Date | null;
}

/**
 * 發送新申請通知給審核者
 */
export async function notifyReviewers(instance: ApprovalInstance) {
  try {
    const requestTypeName = REQUEST_TYPE_NAMES[instance.requestType] || instance.requestType;
    
    // 根據當前層級找到審核者
    let reviewerIds: number[] = [];
    
    if (instance.currentLevel === 1 && instance.department) {
      // 一階審核：找部門主管
      const managers = await prisma.departmentManager.findMany({
        where: {
          department: instance.department,
          isActive: true
        },
        select: { employeeId: true }
      });
      reviewerIds = managers.map(m => m.employeeId);
    } else {
      // 二階審核：找管理員
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { employeeId: true }
      });
      reviewerIds = admins.map(a => a.employeeId).filter((id): id is number => id !== null);
    }

    if (reviewerIds.length === 0) return;

    // 發送通知給每個審核者
    for (const employeeId of reviewerIds) {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true }
      });

      await sendNotification({
        type: 'APPROVAL',
        priority: 'NORMAL',
        channels: ['WEB', 'IN_APP'],
        title: '📋 新審核項目',
        message: `${instance.applicantName} 的${requestTypeName}需要您審核`,
        data: {
          instanceId: instance.id,
          requestType: instance.requestType,
          requestId: instance.requestId,
          applicantName: instance.applicantName
        },
        targetUsers: [String(employeeId)],
        createdBy: 'SYSTEM'
      });
      
      console.log(`📧 已發送審核通知給: ${employee?.name || employeeId}`);
    }

    return { success: true, notifiedCount: reviewerIds.length };
  } catch (error) {
    console.error('發送審核通知失敗:', error);
    return { success: false, error };
  }
}

/**
 * 發送審核結果通知給申請人
 */
export async function notifyApplicant(
  instance: ApprovalInstance, 
  action: 'APPROVE' | 'REJECT',
  reviewerName: string,
  comment?: string
) {
  try {
    const requestTypeName = REQUEST_TYPE_NAMES[instance.requestType] || instance.requestType;
    const isApproved = action === 'APPROVE';
    
    await sendNotification({
      type: 'APPROVAL_RESULT',
      priority: isApproved ? 'NORMAL' : 'HIGH',
      channels: ['WEB', 'IN_APP', 'EMAIL'],
      title: isApproved ? '✅ 申請已核准' : '❌ 申請已退回',
      message: `您的${requestTypeName}已由 ${reviewerName} ${isApproved ? '核准' : '退回'}${comment ? `：${comment}` : ''}`,
      data: {
        instanceId: instance.id,
        requestType: instance.requestType,
        requestId: instance.requestId,
        action,
        reviewerName,
        comment
      },
      targetUsers: [String(instance.applicantId)],
      createdBy: 'SYSTEM'
    });

    console.log(`📧 已發送審核結果通知給申請人: ${instance.applicantName}`);
    return { success: true };
  } catch (error) {
    console.error('發送審核結果通知失敗:', error);
    return { success: false, error };
  }
}

/**
 * 發送審核逾期提醒
 */
export async function notifyOverdueReviews() {
  try {
    const now = new Date();
    
    // 找出即將逾期（24小時內）的審核項目
    const urgentInstances = await prisma.approvalInstance.findMany({
      where: {
        status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] },
        deadlineAt: {
          lte: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          gte: now
        }
      }
    });

    // 找出已逾期的審核項目
    const overdueInstances = await prisma.approvalInstance.findMany({
      where: {
        status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] },
        deadlineAt: { lt: now }
      }
    });

    let sentCount = 0;

    // 發送即將逾期提醒
    for (const instance of urgentInstances) {
      await notifyReviewersAboutDeadline(instance as ApprovalInstance, 'URGENT');
      sentCount++;
    }

    // 發送逾期通知
    for (const instance of overdueInstances) {
      await notifyReviewersAboutDeadline(instance as ApprovalInstance, 'OVERDUE');
      sentCount++;
    }

    return { success: true, sentCount };
  } catch (error) {
    console.error('發送逾期提醒失敗:', error);
    return { success: false, error };
  }
}

/**
 * 發送截止時間相關提醒
 */
async function notifyReviewersAboutDeadline(
  instance: ApprovalInstance,
  type: 'URGENT' | 'OVERDUE'
) {
  const requestTypeName = REQUEST_TYPE_NAMES[instance.requestType] || instance.requestType;
  const isOverdue = type === 'OVERDUE';
  
  // 找到審核者
  let reviewerIds: number[] = [];
  
  if (instance.currentLevel === 1 && instance.department) {
    const managers = await prisma.departmentManager.findMany({
      where: { department: instance.department, isActive: true },
      select: { employeeId: true }
    });
    reviewerIds = managers.map(m => m.employeeId);
  } else {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { employeeId: true }
    });
    reviewerIds = admins.map(a => a.employeeId).filter((id): id is number => id !== null);
  }

  for (const employeeId of reviewerIds) {
    await sendNotification({
      type: 'APPROVAL_REMINDER',
      priority: isOverdue ? 'URGENT' : 'HIGH',
      channels: ['WEB', 'IN_APP', 'EMAIL'],
      title: isOverdue ? '⚠️ 審核已逾期' : '⏰ 審核即將逾期',
      message: isOverdue
        ? `${instance.applicantName} 的${requestTypeName}已逾期未審核，請盡速處理`
        : `${instance.applicantName} 的${requestTypeName}將於 24 小時內逾期`,
      data: {
        instanceId: instance.id,
        requestType: instance.requestType,
        type
      },
      targetUsers: [String(employeeId)],
      createdBy: 'SYSTEM'
    });
  }
}

/**
 * 發送凍結前提醒
 * 提醒有待審核項目且即將凍結的情況
 */
export async function notifyBeforeFreeze(daysBeforeFreeze: number) {
  try {
    // 取得配合凍結時間的待審核項目
    const pendingInstances = await prisma.approvalInstance.findMany({
      where: {
        status: { in: ['PENDING', 'LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] }
      }
    });

    if (pendingInstances.length === 0) return { success: true, sentCount: 0 };

    // 找到所有管理員
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { employeeId: true }
    });

    const adminIds = admins.map(a => a.employeeId).filter((id): id is number => id !== null);

    // 發送通知
    for (const employeeId of adminIds) {
      await sendNotification({
        type: 'FREEZE_REMINDER',
        priority: daysBeforeFreeze <= 1 ? 'URGENT' : 'HIGH',
        channels: ['WEB', 'IN_APP', 'EMAIL'],
        title: daysBeforeFreeze <= 1 ? '⚠️ 考勤凍結倒數' : '📅 考勤凍結提醒',
        message: `距離考勤凍結還有 ${daysBeforeFreeze} 天，目前有 ${pendingInstances.length} 件待審核項目`,
        data: {
          pendingCount: pendingInstances.length,
          daysBeforeFreeze
        },
        targetUsers: [String(employeeId)],
        createdBy: 'SYSTEM'
      });
    }

    return { success: true, sentCount: adminIds.length };
  } catch (error) {
    console.error('發送凍結提醒失敗:', error);
    return { success: false, error };
  }
}
