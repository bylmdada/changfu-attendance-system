/**
 * 審核流程設定 Helper
 * 讀取 ApprovalWorkflow 設定並提供審核邏輯判斷
 */

import { prisma } from './database';
import { dbLogger } from './logger';

export const DEFAULT_APPROVAL_WORKFLOW_DEPARTMENT = '__ALL__';

export interface ApprovalWorkflowConfig {
  workflowType: string;
  department: string;
  workflowName: string;
  approvalLevel: number;       // 1=一階, 2=二階
  requireManager: boolean;     // 是否需主管審核
  finalApprover: string;       // MANAGER 或 ADMIN
  deadlineMode: string;
  deadlineHours: number | null;
  enableForward: boolean;      // 是否允許轉會
  enableCC: boolean;           // 是否 CC 通知 HR
}

export function normalizeApprovalWorkflowDepartment(department?: string | null): string {
  const normalized = department?.trim();
  return normalized ? normalized : DEFAULT_APPROVAL_WORKFLOW_DEPARTMENT;
}

export function getEffectiveApprovalLevel(approvalLevel: number, requireManager: boolean): number {
  const normalizedLevel = Math.min(Math.max(approvalLevel, 1), 2);
  return requireManager ? normalizedLevel : 1;
}

export function normalizeApprovalWorkflowConfig(config: ApprovalWorkflowConfig): ApprovalWorkflowConfig {
  const approvalLevel = getEffectiveApprovalLevel(config.approvalLevel, config.requireManager);

  return {
    ...config,
    approvalLevel,
    finalApprover: config.requireManager ? config.finalApprover : 'ADMIN'
  };
}

// 快取設定，避免每次查詢資料庫
const workflowCache: Map<string, { config: ApprovalWorkflowConfig; expiresAt: number }> = new Map();
const CACHE_TTL = 60 * 1000; // 1 分鐘快取

/**
 * 取得指定類型的審核流程設定
 */
export async function getApprovalWorkflow(
  workflowType: 'LEAVE' | 'OVERTIME' | 'MISSED_CLOCK' | 'SHIFT_CHANGE' | 'SHIFT_SWAP' | string,
  options: { department?: string | null } = {}
): Promise<ApprovalWorkflowConfig | null> {
  const department = normalizeApprovalWorkflowDepartment(options.department);
  const cacheKey = `${workflowType}:${department}`;

  // 從快取取得
  const cached = workflowCache.get(cacheKey);
  if (cached && Date.now() <= cached.expiresAt) {
    return cached.config;
  }
  workflowCache.delete(cacheKey);

  try {
    const workflowDepartments = department === DEFAULT_APPROVAL_WORKFLOW_DEPARTMENT
      ? [DEFAULT_APPROVAL_WORKFLOW_DEPARTMENT]
      : [department, DEFAULT_APPROVAL_WORKFLOW_DEPARTMENT];
    const workflows = await prisma.approvalWorkflow.findMany({
      where: {
        workflowType,
        department: { in: workflowDepartments }
      }
    });
    const workflow = workflows.find((item) => item.isActive && item.department === department)
      ?? workflows.find((item) => item.isActive && item.department === DEFAULT_APPROVAL_WORKFLOW_DEPARTMENT);

    if (!workflow || !workflow.isActive) {
      // 返回預設值
      return normalizeApprovalWorkflowConfig({
        workflowType,
        department: DEFAULT_APPROVAL_WORKFLOW_DEPARTMENT,
        workflowName: workflowType,
        approvalLevel: 2,
        requireManager: true,
        finalApprover: 'ADMIN',
        deadlineMode: 'FIXED',
        deadlineHours: 48,
        enableForward: false,
        enableCC: false
      });
    }

    const config = normalizeApprovalWorkflowConfig({
      workflowType: workflow.workflowType,
      department: workflow.department,
      workflowName: workflow.workflowName,
      approvalLevel: workflow.approvalLevel,
      requireManager: workflow.requireManager,
      finalApprover: workflow.finalApprover,
      deadlineMode: workflow.deadlineMode,
      deadlineHours: workflow.deadlineHours,
      enableForward: workflow.enableForward,
      enableCC: workflow.enableCC
    });

    // 存入快取
    workflowCache.set(cacheKey, {
      config,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return config;
  } catch (error) {
    dbLogger.error('取得審核流程設定失敗，已使用預設流程', {
      error: error instanceof Error ? error : new Error(String(error)),
      context: { workflowType, department },
    });
    // 返回預設值
    return normalizeApprovalWorkflowConfig({
      workflowType,
      department: DEFAULT_APPROVAL_WORKFLOW_DEPARTMENT,
      workflowName: workflowType,
      approvalLevel: 2,
      requireManager: true,
      finalApprover: 'ADMIN',
      deadlineMode: 'FIXED',
      deadlineHours: 48,
      enableForward: false,
      enableCC: false
    });
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
}
