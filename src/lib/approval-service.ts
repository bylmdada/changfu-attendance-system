/**
 * 審核流程服務
 * 提供統一的審核流程管理功能
 */

import { prisma } from '@/lib/database';
import { Prisma } from '@prisma/client';
import { buildActiveDeputyAssignmentWhere } from '@/lib/schedule-management-permissions';
import { getEffectiveApprovalLevel } from '@/lib/approval-workflow';

// 審核流程類型
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

// 審核狀態
export type ApprovalStatus = 
  | 'PENDING'           // 待審核
  | 'LEVEL1_REVIEWING'  // 一階審核中（部門主管）
  | 'LEVEL1_APPROVED'   // 一階已通過
  | 'LEVEL2_REVIEWING'  // 二階審核中（HR會簽）
  | 'LEVEL2_APPROVED'   // 二階已通過（HR同意）
  | 'LEVEL2_DISAGREED'  // 二階不同意（HR不同意但仍進入三階）
  | 'LEVEL3_REVIEWING'  // 三階審核中（管理員決核）
  | 'APPROVED'          // 已通過
  | 'REJECTED';         // 已退回

type ReviewableApprovalInstance = {
  id: number;
  currentLevel: number;
  status: string;
};

type ApprovalDelegateResourceType = 'LEAVE' | 'OVERTIME' | 'SHIFT';

export interface ApprovalDelegateScope {
  delegatorId: number;
  department: string;
  resourceTypes: ApprovalDelegateResourceType[] | null;
}

const APPROVAL_DELEGATE_RESOURCE_TYPES = new Set<ApprovalDelegateResourceType>([
  'LEAVE',
  'OVERTIME',
  'SHIFT'
]);

function buildActiveDeputyDateRangeWhere(now = new Date()) {
  return {
    isActive: true,
    AND: [
      {
        OR: [
          { startDate: null },
          { startDate: { lte: now } }
        ]
      },
      {
        OR: [
          { endDate: null },
          { endDate: { gte: now } }
        ]
      }
    ]
  };
}

function parseApprovalDelegateResourceTypes(resourceTypes: string | null): ApprovalDelegateResourceType[] | null {
  if (!resourceTypes) {
    return null;
  }

  try {
    const parsed = JSON.parse(resourceTypes);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return Array.from(new Set(
      parsed.filter((value): value is ApprovalDelegateResourceType => (
        typeof value === 'string' && APPROVAL_DELEGATE_RESOURCE_TYPES.has(value as ApprovalDelegateResourceType)
      ))
    ));
  } catch {
    return [];
  }
}

function mapRequestTypeToApprovalDelegateResourceType(requestType: string): ApprovalDelegateResourceType | null {
  switch (requestType) {
    case 'LEAVE':
      return 'LEAVE';
    case 'OVERTIME':
      return 'OVERTIME';
    case 'SHIFT_CHANGE':
    case 'SHIFT_SWAP':
    case 'MISSED_CLOCK':
      return 'SHIFT';
    default:
      return null;
  }
}

export function resourceTypesAllowRequest(
  resourceTypes: ApprovalDelegateResourceType[] | null,
  requestType?: string
): boolean {
  if (resourceTypes === null) {
    return true;
  }

  if (!requestType || resourceTypes.length === 0) {
    return false;
  }

  const mappedType = mapRequestTypeToApprovalDelegateResourceType(requestType);
  return mappedType ? resourceTypes.includes(mappedType) : false;
}

export async function getActiveApprovalDelegateScopes(
  delegateEmployeeId: number,
  now = new Date()
): Promise<ApprovalDelegateScope[]> {
  const assignments = await prisma.approvalDelegate.findMany({
    where: {
      delegateId: delegateEmployeeId,
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now }
    },
    select: {
      delegatorId: true,
      resourceTypes: true
    }
  });

  if (assignments.length === 0) {
    return [];
  }

  const delegatorIds = Array.from(new Set(assignments.map(assignment => assignment.delegatorId)));
  const managerRecords = await prisma.departmentManager.findMany({
    where: {
      employeeId: { in: delegatorIds },
      isActive: true
    },
    select: {
      employeeId: true,
      department: true
    }
  });

  if (managerRecords.length === 0) {
    return [];
  }

  const departmentsByDelegator = new Map<number, string[]>();
  for (const managerRecord of managerRecords) {
    const departments = departmentsByDelegator.get(managerRecord.employeeId) ?? [];
    departments.push(managerRecord.department);
    departmentsByDelegator.set(managerRecord.employeeId, departments);
  }

  return assignments.flatMap((assignment) => {
    const departments = departmentsByDelegator.get(assignment.delegatorId) ?? [];
    const resourceTypes = parseApprovalDelegateResourceTypes(assignment.resourceTypes);

    return departments.map((department) => ({
      delegatorId: assignment.delegatorId,
      department,
      resourceTypes
    }));
  });
}

export function isTerminalApprovalStatus(status: string): boolean {
  return status === 'APPROVED' || status === 'REJECTED';
}

export function determineApprovalTransition(
  currentLevel: number,
  maxLevel: number,
  action: 'APPROVE' | 'REJECT' | 'FORWARD',
  reviewerRole: string,
  currentStatus: ApprovalStatus
): { newStatus: ApprovalStatus; newLevel: number } {
  let newStatus: ApprovalStatus;
  let newLevel = currentLevel;

  if (action === 'REJECT') {
    if (reviewerRole === 'HR') {
      newLevel = 3;
      newStatus = 'LEVEL3_REVIEWING';
    } else {
      newStatus = 'REJECTED';
    }

    return { newStatus, newLevel };
  }

  if (action === 'FORWARD') {
    return {
      newStatus: currentStatus,
      newLevel,
    };
  }

  if (currentLevel >= maxLevel) {
    return {
      newStatus: 'APPROVED',
      newLevel,
    };
  }

  const nextLevel = currentLevel + 1;

  if (nextLevel === 2) {
    return {
      newStatus: 'LEVEL2_REVIEWING',
      newLevel: 2,
    };
  }

  if (nextLevel === 3) {
    return {
      newStatus: 'LEVEL3_REVIEWING',
      newLevel: 3,
    };
  }

  return {
    newStatus: 'APPROVED',
    newLevel,
  };
}

export async function ensureApprovalReviewAllowed(
  tx: Prisma.TransactionClient | typeof prisma,
  instance: ReviewableApprovalInstance,
  reviewerId: number
): Promise<void> {
  if (isTerminalApprovalStatus(instance.status)) {
    throw new Error('此審核已完成，無法再次審核');
  }

  const existingReview = await tx.approvalReview.findFirst({
    where: {
      instanceId: instance.id,
      reviewerId,
      level: instance.currentLevel
    },
    select: { id: true }
  });

  if (existingReview) {
    throw new Error('您已完成此關卡審核，請勿重複送出');
  }
}

interface CreateApprovalParams {
  requestType: WorkflowType;
  requestId: number;
  applicantId: number;
  applicantName: string;
  department?: string;
}

interface ReviewParams {
  instanceId: number;
  reviewerId: number;
  reviewerName: string;
  reviewerRole: 'MANAGER' | 'DEPUTY' | 'HR' | 'ADMIN';
  action: 'APPROVE' | 'REJECT' | 'FORWARD';
  comment?: string;
  forwardToId?: number;
  forwardReason?: string;
  isDeputy?: boolean;
}

/**
 * 取得審核流程設定
 */
export async function getWorkflowConfig(workflowType: WorkflowType) {
  const workflow = await prisma.approvalWorkflow.findUnique({
    where: { workflowType }
  });
  
  if (!workflow) {
    // 預設設定：三階審核
    return {
      approvalLevel: 3,  // 一階主管 + 二階HR + 三階ADMIN
      requireManager: true,
      requireHr: true,   // HR會簽
      deadlineMode: 'FIXED' as const,
      deadlineHours: 48
    };
  }
  
  return {
    ...workflow,
    approvalLevel: getEffectiveApprovalLevel(workflow.approvalLevel, workflow.requireManager),
    finalApprover: workflow.requireManager ? workflow.finalApprover : 'ADMIN'
  };
}

/**
 * 建立審核實例
 */
export async function createApprovalInstance(params: CreateApprovalParams) {
  const { requestType, requestId, applicantId, applicantName, department } = params;
  
  const workflow = await getWorkflowConfig(requestType);
  
  // 計算截止時間
  let deadlineAt: Date | null = null;
  if (workflow.deadlineMode === 'FIXED' && workflow.deadlineHours) {
    deadlineAt = new Date();
    deadlineAt.setHours(deadlineAt.getHours() + workflow.deadlineHours);
  }
  
  // 決定初始狀態
  const initialStatus = 'LEVEL1_REVIEWING';
  const maxLevel = workflow.approvalLevel;
  
  const instance = await prisma.approvalInstance.create({
    data: {
      requestType,
      requestId,
      applicantId,
      applicantName,
      department,
      currentLevel: 1,
      maxLevel,
      requireManager: workflow.requireManager,
      status: initialStatus,
      deadlineAt
    }
  });
  
  return instance;
}

/**
 * 取得部門主管
 */
export async function getDepartmentManager(department: string) {
  const now = new Date();
  const manager = await prisma.departmentManager.findFirst({
    where: {
      department,
      isPrimary: true,
      isActive: true
    },
    include: {
      employee: {
        select: { id: true, name: true }
      },
      deputies: {
        where: buildActiveDeputyDateRangeWhere(now),
        include: {
          deputyEmployee: {
            select: { id: true, name: true }
          }
        }
      }
    }
  });
  
  return manager;
}

/**
 * 檢查是否為審核者
 */
export async function isReviewerFor(employeeId: number, department: string, requestType?: string) {
  const now = new Date();

  // 檢查是否為該部門主管
  const manager = await prisma.departmentManager.findFirst({
    where: {
      employeeId,
      department,
      isActive: true
    }
  });
  
  if (manager) {
    return { isReviewer: true, role: 'MANAGER' as const };
  }
  
  // 檢查是否為代理人
  const deputy = await prisma.managerDeputy.findFirst({
    where: {
      ...buildActiveDeputyAssignmentWhere(employeeId, now),
      manager: {
        department,
        isActive: true
      }
    }
  });
  
  if (deputy) {
    return { isReviewer: true, role: 'DEPUTY' as const };
  }

  const approvalDelegateScopes = await getActiveApprovalDelegateScopes(employeeId, now);
  const delegatedPermission = approvalDelegateScopes.some((scope) => (
    scope.department === department &&
    resourceTypesAllowRequest(scope.resourceTypes, requestType)
  ));

  if (delegatedPermission) {
    return { isReviewer: true, role: 'DEPUTY' as const };
  }
  
  return { isReviewer: false, role: null };
}

/**
 * 執行審核
 */
export async function performReview(params: ReviewParams) {
  const { 
    instanceId, 
    reviewerId, 
    reviewerName, 
    reviewerRole, 
    action, 
    comment,
    forwardToId,
    forwardReason,
    isDeputy = false 
  } = params;
  
  const updatedInstance = await prisma.$transaction(async (tx) => {
    const instance = await tx.approvalInstance.findUnique({
      where: { id: instanceId }
    });

    if (!instance) {
      throw new Error('找不到審核實例');
    }

    await ensureApprovalReviewAllowed(tx, instance, reviewerId);

    const { newStatus, newLevel } = determineApprovalTransition(
      instance.currentLevel,
      instance.maxLevel,
      action,
      reviewerRole,
      instance.status as ApprovalStatus
    );

    await tx.approvalReview.create({
      data: {
        instanceId,
        level: instance.currentLevel,
        reviewerId,
        reviewerName,
        reviewerRole,
        isDeputy,
        action,
        comment,
        forwardToId,
        forwardReason
      }
    });

    const updatedCount = await tx.approvalInstance.updateMany({
      where: {
        id: instanceId,
        currentLevel: instance.currentLevel,
        status: instance.status
      },
      data: {
        status: newStatus,
        currentLevel: newLevel
      }
    });

    if (updatedCount.count !== 1) {
      throw new Error('審核狀態已變更，請重新整理後再試');
    }

    return tx.approvalInstance.findUnique({
      where: { id: instanceId }
    });
  });

  if (!updatedInstance) {
    throw new Error('找不到更新後的審核實例');
  }
  
  return updatedInstance;
}

/**
 * 取得待審核項目
 */
export async function getPendingApprovals(employeeId: number, role: string) {
  const where: {
    status: { in: string[] };
    OR?: Array<{ currentLevel: number; requireManager?: boolean } | { department?: string }>;
  } = {
    status: { in: ['PENDING', 'LEVEL1_REVIEWING', 'LEVEL2_REVIEWING', 'LEVEL3_REVIEWING'] }
  };
  
  // 三階審核流程權限
  if (role === 'ADMIN') {
    // ADMIN 可看所有待審核項目（HR只是會簽，決核權在管理員）
    // 不設 OR 條件，讓管理員看到所有待審核項目
  } else if (role === 'HR') {
    // HR 看二階待會簽項目 + 不需主管的一階項目
    where.OR = [
      { currentLevel: 2 },
      { currentLevel: 1, requireManager: false }
    ];
  } else {
    // 主管只能看到自己部門的一階項目
    const managedDepts = await prisma.departmentManager.findMany({
      where: { employeeId, isActive: true },
      select: { department: true }
    });
    
    const departments = managedDepts.map(d => d.department);
    
    if (departments.length === 0) {
      return [];
    }
    
    where.OR = departments.map(dept => ({
      currentLevel: 1,
      department: dept
    }));
  }
  
  const instances = await prisma.approvalInstance.findMany({
    where,
    include: {
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 5
      }
    },
    orderBy: [
      { createdAt: 'asc' }
    ]
  });
  
  return instances;
}

/**
 * 取得我的申請
 */
export async function getMyApplications(applicantId: number) {
  const instances = await prisma.approvalInstance.findMany({
    where: { applicantId },
    include: {
      reviews: {
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  return instances;
}

/**
 * 取得審核統計
 */
export async function getApprovalStats(employeeId: number, role: string) {
  const pending = await getPendingApprovals(employeeId, role);
  
  const now = new Date();
  const urgent = pending.filter(p => 
    p.deadlineAt && new Date(p.deadlineAt) < new Date(now.getTime() + 24 * 60 * 60 * 1000)
  );
  const overdue = pending.filter(p => 
    p.deadlineAt && new Date(p.deadlineAt) < now
  );
  
  return {
    total: pending.length,
    urgent: urgent.length,
    overdue: overdue.length
  };
}
