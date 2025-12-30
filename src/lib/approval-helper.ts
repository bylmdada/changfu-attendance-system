/**
 * 審核流程幫助函數
 * 提供簡化的審核實例建立功能
 */

import { prisma } from '@/lib/database';

export type WorkflowType = 
  | 'SHIFT_CHANGE' 
  | 'SHIFT_SWAP' 
  | 'MISSED_CLOCK' 
  | 'LEAVE' 
  | 'OVERTIME' 
  | 'PURCHASE' 
  | 'RESIGNATION' 
  | 'PAYROLL_DISPUTE' 
  | 'DEPENDENT_APP' 
  | 'ANNOUNCEMENT';

interface CreateApprovalParams {
  requestType: WorkflowType;
  requestId: number;
  applicantId: number;
  applicantName: string;
  department?: string | null;
}

/**
 * 建立審核實例
 * 自動取得該類型的審核流程設定並建立審核實例
 */
export async function createApprovalForRequest(params: CreateApprovalParams) {
  const { requestType, requestId, applicantId, applicantName, department } = params;

  try {
    // 取得審核流程設定
    const workflow = await prisma.approvalWorkflow.findUnique({
      where: { workflowType: requestType }
    });

    // 預設設定
    const approvalLevel = workflow?.approvalLevel ?? 2;
    const requireManager = workflow?.requireManager ?? true;
    const deadlineMode = workflow?.deadlineMode ?? 'FIXED';
    const deadlineHours = workflow?.deadlineHours ?? 48;

    // 計算截止時間
    let deadlineAt: Date | null = null;
    if (deadlineMode === 'FIXED' && deadlineHours) {
      deadlineAt = new Date();
      deadlineAt.setHours(deadlineAt.getHours() + deadlineHours);
    } else if (deadlineMode === 'FREEZE_BASED') {
      // 配合凍結時間，先取得凍結設定
      const freezeSettings = await prisma.systemSettings.findFirst({
        where: { key: 'attendance_freeze' }
      });
      if (freezeSettings?.value) {
        try {
          const parsed = JSON.parse(freezeSettings.value);
          const freezeDay = parsed.freezeDay || 5;
          const freezeTime = parsed.freezeTime || '18:00';
          
          const now = new Date();
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, freezeDay);
          const [hours, minutes] = freezeTime.split(':').map(Number);
          nextMonth.setHours(hours, minutes, 0, 0);
          
          deadlineAt = nextMonth;
        } catch {
          // 無法解析，使用預設 72 小時
          deadlineAt = new Date();
          deadlineAt.setHours(deadlineAt.getHours() + 72);
        }
      }
    }

    // 決定初始狀態和層級
    const currentLevel = requireManager ? 1 : 2;
    const status = requireManager ? 'LEVEL1_REVIEWING' : 'LEVEL2_REVIEWING';

    // 建立審核實例
    const instance = await prisma.approvalInstance.create({
      data: {
        requestType,
        requestId,
        applicantId,
        applicantName,
        department: department || null,
        currentLevel,
        maxLevel: approvalLevel,
        requireManager,
        status,
        deadlineAt
      }
    });

    return { success: true, instance };
  } catch (error) {
    console.error('建立審核實例失敗:', error);
    return { success: false, error };
  }
}

/**
 * 更新原始申請狀態
 * 當審核完成時，更新對應的原始申請記錄
 */
export async function updateRequestStatus(
  requestType: WorkflowType, 
  requestId: number, 
  status: 'APPROVED' | 'REJECTED'
) {
  try {
    switch (requestType) {
      case 'LEAVE':
        await prisma.leaveRequest.update({
          where: { id: requestId },
          data: { status }
        });
        break;
      case 'OVERTIME':
        await prisma.overtimeRequest.update({
          where: { id: requestId },
          data: { status }
        });
        break;
      case 'MISSED_CLOCK':
        await prisma.missedClockRequest.update({
          where: { id: requestId },
          data: { status }
        });
        break;
      case 'PURCHASE':
        await prisma.purchaseRequest.update({
          where: { id: requestId },
          data: { status }
        });
        break;
      case 'RESIGNATION':
        await prisma.resignationRecord.update({
          where: { id: requestId },
          data: { status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED' }
        });
        break;
      case 'PAYROLL_DISPUTE':
        await prisma.payrollDispute.update({
          where: { id: requestId },
          data: { status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED' }
        });
        break;
      case 'DEPENDENT_APP':
        await prisma.dependentApplication.update({
          where: { id: requestId },
          data: { status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED' }
        });
        break;
      case 'SHIFT_CHANGE':
      case 'SHIFT_SWAP':
        await prisma.shiftExchangeRequest.update({
          where: { id: requestId },
          data: { status }
        });
        break;
      case 'ANNOUNCEMENT':
        // 公告發布特殊處理：通過後更新為已發布狀態
        await prisma.announcement.update({
          where: { id: requestId },
          data: { 
            isPublished: status === 'APPROVED',
            publishedAt: status === 'APPROVED' ? new Date() : null
          }
        });
        break;
      default:
        console.warn(`未處理的申請類型: ${requestType}`);
    }
    return { success: true };
  } catch (error) {
    console.error('更新申請狀態失敗:', error);
    return { success: false, error };
  }
}
