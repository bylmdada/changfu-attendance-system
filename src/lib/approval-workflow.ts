/**
 * 審核流程設定 Helper
 * 讀取 ApprovalWorkflow 設定並提供審核邏輯判斷
 */

import { prisma } from './database';

export interface ApprovalWorkflowConfig {
  workflowType: string;
  workflowName: string;
  approvalLevel: number;       // 1=一階, 2=二階
  requireManager: boolean;     // 是否需主管審核
  finalApprover: string;       // MANAGER 或 ADMIN
  enableCC: boolean;           // 是否 CC 通知 HR
}

// 快取設定，避免每次查詢資料庫
let workflowCache: Map<string, ApprovalWorkflowConfig> = new Map();
let cacheExpiry: number = 0;
const CACHE_TTL = 60 * 1000; // 1 分鐘快取

/**
 * 取得指定類型的審核流程設定
 */
export async function getApprovalWorkflow(
  workflowType: 'LEAVE' | 'OVERTIME' | 'MISSED_CLOCK' | 'SHIFT_CHANGE' | 'SHIFT_SWAP' | string
): Promise<ApprovalWorkflowConfig | null> {
  // 檢查快取是否過期
  if (Date.now() > cacheExpiry) {
    workflowCache.clear();
  }

  // 從快取取得
  if (workflowCache.has(workflowType)) {
    return workflowCache.get(workflowType)!;
  }

  try {
    const workflow = await prisma.approvalWorkflow.findUnique({
      where: { workflowType }
    });

    if (!workflow || !workflow.isActive) {
      // 返回預設值
      return {
        workflowType,
        workflowName: workflowType,
        approvalLevel: 2,
        requireManager: true,
        finalApprover: 'ADMIN',
        enableCC: false
      };
    }

    const config: ApprovalWorkflowConfig = {
      workflowType: workflow.workflowType,
      workflowName: workflow.workflowName,
      approvalLevel: workflow.approvalLevel,
      requireManager: workflow.requireManager,
      finalApprover: workflow.finalApprover,
      enableCC: workflow.enableCC
    };

    // 存入快取
    workflowCache.set(workflowType, config);
    cacheExpiry = Date.now() + CACHE_TTL;

    return config;
  } catch (error) {
    console.error('取得審核流程設定失敗:', error);
    // 返回預設值
    return {
      workflowType,
      workflowName: workflowType,
      approvalLevel: 2,
      requireManager: true,
      finalApprover: 'ADMIN',
      enableCC: false
    };
  }
}

/**
 * 判斷是否為二階審核流程
 */
export async function isTwoLevelApproval(workflowType: string): Promise<boolean> {
  const config = await getApprovalWorkflow(workflowType);
  return config ? config.approvalLevel >= 2 && config.requireManager : true;
}

/**
 * 清除快取（用於設定更新後）
 */
export function clearWorkflowCache() {
  workflowCache.clear();
  cacheExpiry = 0;
}
