import { prisma } from '@/lib/database';
import { NextRequest } from 'next/server';

// 審計日誌操作類型常數
export const AuditAction = {
  // 打卡相關
  CLOCK_IN: 'CLOCK_IN',
  CLOCK_OUT: 'CLOCK_OUT',
  CLOCK_FAILED: 'CLOCK_FAILED',
  
  // 認證相關
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  
  // 設定相關
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  LOCATION_ADD: 'LOCATION_ADD',
  LOCATION_UPDATE: 'LOCATION_UPDATE',
  LOCATION_DELETE: 'LOCATION_DELETE',
  
  // 員工管理
  EMPLOYEE_CREATE: 'EMPLOYEE_CREATE',
  EMPLOYEE_UPDATE: 'EMPLOYEE_UPDATE',
  EMPLOYEE_DELETE: 'EMPLOYEE_DELETE',
  
  // 請假/加班
  LEAVE_REQUEST: 'LEAVE_REQUEST',
  LEAVE_APPROVE: 'LEAVE_APPROVE',
  LEAVE_REJECT: 'LEAVE_REJECT',
  OVERTIME_REQUEST: 'OVERTIME_REQUEST',
  OVERTIME_APPROVE: 'OVERTIME_APPROVE',
} as const;

export type AuditActionType = typeof AuditAction[keyof typeof AuditAction];

// 從請求中提取客戶端資訊
function getClientInfo(request?: NextRequest) {
  if (!request) return { ipAddress: null, userAgent: null };
  
  const ipAddress = 
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-vercel-forwarded-for') ||
    'unknown';
  
  const userAgent = request.headers.get('user-agent') || null;
  
  return { ipAddress, userAgent };
}

// 審計日誌記錄參數介面
interface AuditLogParams {
  userId?: number;
  employeeId?: number;
  action: AuditActionType;
  targetType?: string;
  targetId?: number;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  description?: string;
  success?: boolean;
  errorMsg?: string;
  request?: NextRequest;
}

/**
 * 記錄審計日誌
 * @param params 審計日誌參數
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    const { ipAddress, userAgent } = getClientInfo(params.request);
    
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        employeeId: params.employeeId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        oldValue: params.oldValue ? JSON.stringify(params.oldValue) : null,
        newValue: params.newValue ? JSON.stringify(params.newValue) : null,
        description: params.description,
        success: params.success ?? true,
        errorMsg: params.errorMsg,
        ipAddress,
        userAgent,
      }
    });
  } catch (error) {
    // 審計日誌失敗不應影響主要業務流程
    console.error('審計日誌記錄失敗:', error);
  }
}

/**
 * 快速記錄打卡審計日誌
 */
export async function logClockAudit(
  employeeId: number,
  action: 'CLOCK_IN' | 'CLOCK_OUT' | 'CLOCK_FAILED',
  attendanceId: number | null,
  success: boolean,
  request?: NextRequest,
  errorMsg?: string
): Promise<void> {
  await logAudit({
    employeeId,
    action: AuditAction[action],
    targetType: 'AttendanceRecord',
    targetId: attendanceId ?? undefined,
    success,
    errorMsg,
    request,
    description: success 
      ? `${action === 'CLOCK_IN' ? '上班' : '下班'}打卡成功`
      : `打卡失敗: ${errorMsg}`,
  });
}

/**
 * 查詢審計日誌
 */
export async function getAuditLogs(options: {
  userId?: number;
  employeeId?: number;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  
  if (options.userId) where.userId = options.userId;
  if (options.employeeId) where.employeeId = options.employeeId;
  if (options.action) where.action = options.action;
  if (options.success !== undefined) where.success = options.success;
  
  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) (where.createdAt as Record<string, Date>).gte = options.startDate;
    if (options.endDate) (where.createdAt as Record<string, Date>).lte = options.endDate;
  }
  
  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options.limit || 50,
    skip: options.offset || 0,
  });
}
