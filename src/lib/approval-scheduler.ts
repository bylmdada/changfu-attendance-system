/**
 * 審核逾期自動處理排程
 * 處理逾期的審核項目（自動升級、自動拒絕、統計報告）
 */

import { prisma } from '@/lib/database';
import { updateRequestStatus, WorkflowType } from '@/lib/approval-helper';
import { notifyApplicant, notifyReviewers } from '@/lib/approval-notifications';
import { sendNotification } from '@/lib/realtime-notifications';

// 逾期處理設定介面
interface OverdueSettings {
  enabled: boolean;                    // 是否啟用自動處理
  autoEscalateEnabled: boolean;        // 是否啟用自動升級
  autoEscalateHours: number;           // 一階逾期多少小時後升級到二階
  autoRejectEnabled: boolean;          // 是否啟用自動拒絕
  autoRejectDays: number;              // 嚴重逾期多少天後自動拒絕
  dailyReportEnabled: boolean;         // 是否啟用每日報告
  dailyReportTime: string;             // 每日報告時間 "HH:mm"
}

// 預設設定（預設全部關閉）
const DEFAULT_SETTINGS: OverdueSettings = {
  enabled: false,
  autoEscalateEnabled: false,
  autoEscalateHours: 24,
  autoRejectEnabled: false,
  autoRejectDays: 7,
  dailyReportEnabled: false,
  dailyReportTime: '09:00'
};

/**
 * 取得逾期處理設定
 */
export async function getOverdueSettings(): Promise<OverdueSettings> {
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { key: 'approval_overdue_settings' }
    });

    if (settings?.value) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(settings.value) };
    }

    return DEFAULT_SETTINGS;
  } catch (error) {
    console.error('取得逾期處理設定失敗:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * 更新逾期處理設定
 */
export async function updateOverdueSettings(newSettings: Partial<OverdueSettings>) {
  try {
    const current = await getOverdueSettings();
    const updated = { ...current, ...newSettings };

    await prisma.systemSettings.upsert({
      where: { key: 'approval_overdue_settings' },
      update: { value: JSON.stringify(updated) },
      create: { key: 'approval_overdue_settings', value: JSON.stringify(updated) }
    });

    return { success: true, settings: updated };
  } catch (error) {
    console.error('更新逾期處理設定失敗:', error);
    return { success: false, error };
  }
}

interface ProcessOverdueApprovalOptions {
  forceRun?: boolean;
}

/**
 * 處理逾期項目主函數
 * 建議由 cron job 每小時或每日執行
 */
export async function processOverdueApprovals(options: ProcessOverdueApprovalOptions = {}) {
  const settings = await getOverdueSettings();

  // 如果功能未啟用，直接返回
  if (!settings.enabled && !options.forceRun) {
    console.log('⏸️ 逾期自動處理功能未啟用');
    return { 
      skipped: true, 
      reason: '功能未啟用',
      escalated: 0, 
      rejected: 0, 
      reportSent: false 
    };
  }

  const now = new Date();
  let escalatedCount = 0;
  let rejectedCount = 0;
  let reportSent = false;

  // 1. 自動升級處理
  if (settings.autoEscalateEnabled) {
    const escalateThreshold = new Date(now.getTime() - settings.autoEscalateHours * 60 * 60 * 1000);
    
    const escalateItems = await prisma.approvalInstance.findMany({
      where: {
        status: 'LEVEL1_REVIEWING',
        currentLevel: 1,
        deadlineAt: { lt: escalateThreshold }
      }
    });

    for (const item of escalateItems) {
      try {
        // 建立系統審核紀錄
        await prisma.approvalReview.create({
          data: {
            instanceId: item.id,
            level: 1,
            reviewerId: 0, // 系統
            reviewerName: 'SYSTEM',
            reviewerRole: 'SYSTEM',
            action: 'ESCALATE',
            comment: `逾期超過 ${settings.autoEscalateHours} 小時，系統自動升級到二階審核`
          }
        });

        // 更新審核實例
        await prisma.approvalInstance.update({
          where: { id: item.id },
          data: {
            currentLevel: 2,
            status: 'LEVEL2_REVIEWING'
          }
        });

        // 通知二階審核者
        await notifyReviewers({
          id: item.id,
          requestType: item.requestType,
          requestId: item.requestId,
          applicantId: item.applicantId,
          applicantName: item.applicantName,
          department: item.department,
          currentLevel: 2,
          status: 'LEVEL2_REVIEWING',
          deadlineAt: item.deadlineAt
        });

        escalatedCount++;
        console.log(`📤 已自動升級: ${item.id} → 二階審核`);
      } catch (err) {
        console.error(`升級失敗 ${item.id}:`, err);
      }
    }
  }

  // 2. 自動拒絕處理
  if (settings.autoRejectEnabled) {
    const rejectThreshold = new Date(now.getTime() - settings.autoRejectDays * 24 * 60 * 60 * 1000);
    
    const rejectItems = await prisma.approvalInstance.findMany({
      where: {
        status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] },
        deadlineAt: { lt: rejectThreshold }
      }
    });

    for (const item of rejectItems) {
      try {
        // 建立系統審核紀錄
        await prisma.approvalReview.create({
          data: {
            instanceId: item.id,
            level: item.currentLevel,
            reviewerId: 0,
            reviewerName: 'SYSTEM',
            reviewerRole: 'SYSTEM',
            action: 'REJECT',
            comment: `逾期超過 ${settings.autoRejectDays} 天，系統自動取消`
          }
        });

        // 更新審核實例
        await prisma.approvalInstance.update({
          where: { id: item.id },
          data: { status: 'REJECTED' }
        });

        // 更新原始申請狀態
        await updateRequestStatus(
          item.requestType as WorkflowType,
          item.requestId,
          'REJECTED'
        );

        // 通知申請人
        await notifyApplicant(
          {
            id: item.id,
            requestType: item.requestType,
            requestId: item.requestId,
            applicantId: item.applicantId,
            applicantName: item.applicantName,
            department: item.department,
            currentLevel: item.currentLevel,
            status: 'REJECTED',
            deadlineAt: item.deadlineAt
          },
          'REJECT',
          'SYSTEM',
          `逾期超過 ${settings.autoRejectDays} 天未審核，已自動取消`
        );

        rejectedCount++;
        console.log(`❌ 已自動拒絕: ${item.id} (逾期未審核)`);
      } catch (err) {
        console.error(`拒絕失敗 ${item.id}:`, err);
      }
    }
  }

  // 3. 發送每日統計報告
  if (settings.dailyReportEnabled) {
    reportSent = await sendDailyOverdueReport();
  }

  const result = {
    skipped: false,
    escalated: escalatedCount,
    rejected: rejectedCount,
    reportSent,
    processedAt: now.toISOString()
  };

  console.log('✅ 逾期自動處理完成:', result);
  return result;
}

/**
 * 發送每日逾期統計報告給管理員
 */
async function sendDailyOverdueReport(): Promise<boolean> {
  try {
    const now = new Date();

    // 統計數據
    const [total, overdue, urgent, level1, level2] = await Promise.all([
      prisma.approvalInstance.count({
        where: { status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] } }
      }),
      prisma.approvalInstance.count({
        where: {
          status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] },
          deadlineAt: { lt: now }
        }
      }),
      prisma.approvalInstance.count({
        where: {
          status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] },
          deadlineAt: {
            gte: now,
            lte: new Date(now.getTime() + 24 * 60 * 60 * 1000)
          }
        }
      }),
      prisma.approvalInstance.count({
        where: { status: 'LEVEL1_REVIEWING' }
      }),
      prisma.approvalInstance.count({
        where: { status: 'LEVEL2_REVIEWING' }
      })
    ]);

    // 如果沒有待審核項目，不發送報告
    if (total === 0) {
      console.log('📊 無待審核項目，跳過報告');
      return false;
    }

    // 發送通知給管理員
    await sendNotification({
      type: 'APPROVAL_REMINDER',
      priority: overdue > 0 ? 'URGENT' : (urgent > 0 ? 'HIGH' : 'NORMAL'),
      channels: ['WEB', 'IN_APP'],
      title: '📊 每日審核統計報告',
      message: `待審核共 ${total} 件：主管審核 ${level1} 件、管理員審核 ${level2} 件` +
               (overdue > 0 ? `。⚠️ 已逾期 ${overdue} 件！` : '') +
               (urgent > 0 ? `。⏰ 即將逾期 ${urgent} 件` : ''),
      data: {
        total,
        overdue,
        urgent,
        level1,
        level2,
        reportDate: now.toISOString().split('T')[0]
      },
      targetRoles: ['ADMIN'],
      createdBy: 'SYSTEM'
    });

    console.log('📧 已發送每日統計報告');
    return true;
  } catch (error) {
    console.error('發送每日統計報告失敗:', error);
    return false;
  }
}

/**
 * 取得逾期統計（供儀表板使用）
 */
export async function getOverdueStats() {
  const now = new Date();

  const [total, overdue, urgent, todayProcessed] = await Promise.all([
    prisma.approvalInstance.count({
      where: { status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] } }
    }),
    prisma.approvalInstance.count({
      where: {
        status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] },
        deadlineAt: { lt: now }
      }
    }),
    prisma.approvalInstance.count({
      where: {
        status: { in: ['LEVEL1_REVIEWING', 'LEVEL2_REVIEWING'] },
        deadlineAt: {
          gte: now,
          lte: new Date(now.getTime() + 24 * 60 * 60 * 1000)
        }
      }
    }),
    prisma.approvalReview.count({
      where: {
        createdAt: {
          gte: new Date(now.setHours(0, 0, 0, 0))
        }
      }
    })
  ]);

  return {
    total,
    overdue,
    urgent,
    todayProcessed,
    percentOverdue: total > 0 ? Math.round((overdue / total) * 100) : 0
  };
}
