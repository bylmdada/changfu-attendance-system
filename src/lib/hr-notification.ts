/**
 * HR 通知服務
 * 主管審核完成後 CC 通知 HR
 */

import { prisma } from './database';

interface HRNotificationData {
  requestType: 'LEAVE' | 'OVERTIME' | 'MISSED_CLOCK' | 'SHIFT_EXCHANGE' | string;
  requestId: number;
  employeeName: string;
  employeeDepartment: string;
  managerName: string;
  managerOpinion: 'AGREE' | 'DISAGREE';
  managerNote?: string | null;
  requestDetails?: string;
}

/**
 * 取得所有 HR 角色的員工
 */
export async function getHREmployees() {
  try {
    // 透過 User 表查詢 HR 角色
    const hrUsers = await prisma.user.findMany({
      where: {
        role: 'HR',
        employee: {
          isActive: true
        }
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    return hrUsers
      .filter(u => u.employee)
      .map(u => u.employee!);
  } catch (error) {
    console.error('取得 HR 員工失敗:', error);
    return [];
  }
}

/**
 * 主管審核後通知 HR
 */
export async function notifyHRAfterManagerReview(data: HRNotificationData): Promise<void> {
  try {
    const hrEmployees = await getHREmployees();
    
    if (hrEmployees.length === 0) {
      console.log('無 HR 員工需通知');
      return;
    }

    const requestTypeNames: Record<string, string> = {
      LEAVE: '請假申請',
      OVERTIME: '加班申請',
      MISSED_CLOCK: '補打卡申請',
      SHIFT_EXCHANGE: '調班申請'
    };

    const requestTypeName = requestTypeNames[data.requestType] || data.requestType;
    const opinionText = data.managerOpinion === 'AGREE' ? '同意' : '不同意';

    // 建立系統通知
    const notificationMessage = `[CC] ${data.employeeDepartment} ${data.employeeName} 的${requestTypeName}已由主管 ${data.managerName} 審核。意見：${opinionText}${data.managerNote ? ` / 備註：${data.managerNote}` : ''}`;

    // 為每個 HR 建立通知記錄
    for (const hr of hrEmployees) {
      try {
        await prisma.notification.create({
          data: {
            employeeId: hr.id,
            type: 'APPROVAL_CC',
            title: `${requestTypeName}主管審核通知`,
            message: notificationMessage,
            isRead: false
          }
        });
      } catch (notifyError) {
        console.error(`建立 HR ${hr.name} 通知失敗:`, notifyError);
      }
    }

    console.log(`已 CC 通知 ${hrEmployees.length} 位 HR: ${hrEmployees.map(h => h.name).join(', ')}`);

  } catch (error) {
    console.error('通知 HR 失敗:', error);
    // 不拋出錯誤，避免影響主流程
  }
}
