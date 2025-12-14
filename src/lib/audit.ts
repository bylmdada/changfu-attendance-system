/**
 * 操作紀錄服務
 * 提供記錄敏感操作的工具函式
 */

import { prisma } from '@/lib/database';
import { NextRequest } from 'next/server';

// 操作類型
export enum AuditAction {
  // 認證相關
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET = 'PASSWORD_RESET',
  
  // 考勤相關
  CLOCK_IN = 'CLOCK_IN',
  CLOCK_OUT = 'CLOCK_OUT',
  ATTENDANCE_EDIT = 'ATTENDANCE_EDIT',
  ATTENDANCE_FREEZE = 'ATTENDANCE_FREEZE',
  
  // CRUD 操作
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  VIEW = 'VIEW',
  
  // 薪資相關
  PAYROLL_GENERATE = 'PAYROLL_GENERATE',
  PAYROLL_EXPORT = 'PAYROLL_EXPORT',
  SALARY_UPDATE = 'SALARY_UPDATE',
  
  // 系統設定
  SETTINGS_UPDATE = 'SETTINGS_UPDATE',
  
  // 匯出
  EXPORT = 'EXPORT',
}

// 目標類型
export enum AuditTargetType {
  EMPLOYEE = 'Employee',
  USER = 'User',
  ATTENDANCE_RECORD = 'AttendanceRecord',
  LEAVE_REQUEST = 'LeaveRequest',
  OVERTIME_REQUEST = 'OvertimeRequest',
  SCHEDULE = 'Schedule',
  PAYROLL_RECORD = 'PayrollRecord',
  ANNOUNCEMENT = 'Announcement',
  SYSTEM_SETTINGS = 'SystemSettings',
  BONUS = 'Bonus',
  SHIFT_EXCHANGE = 'ShiftExchange',
}

// 記錄操作日誌選項
interface LogAuditOptions {
  userId?: number;
  employeeId?: number;
  action: AuditAction | string;
  targetType?: AuditTargetType | string;
  targetId?: number;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMsg?: string;
}

/**
 * 從請求中取得 IP 和 User Agent
 */
export function getRequestInfo(request: NextRequest): { ip: string; userAgent: string } {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return { ip, userAgent };
}

/**
 * 記錄操作日誌
 */
export async function logAudit(options: LogAuditOptions): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: options.userId,
        employeeId: options.employeeId,
        action: options.action,
        targetType: options.targetType || null,
        targetId: options.targetId || null,
        oldValue: options.oldValue ? JSON.stringify(options.oldValue) : null,
        newValue: options.newValue ? JSON.stringify(options.newValue) : null,
        description: options.description || null,
        ipAddress: options.ipAddress || null,
        userAgent: options.userAgent || null,
        success: options.success !== false,
        errorMsg: options.errorMsg || null,
      },
    });
  } catch (error) {
    // 日誌記錄失敗不應影響主要業務邏輯
    console.error('[AuditLog] 記錄操作日誌失敗:', error);
  }
}

/**
 * 記錄登入事件
 */
export async function logLogin(
  userId: number,
  employeeId: number,
  request: NextRequest,
  success: boolean,
  errorMsg?: string
): Promise<void> {
  const { ip, userAgent } = getRequestInfo(request);
  await logAudit({
    userId,
    employeeId,
    action: success ? AuditAction.LOGIN : AuditAction.LOGIN_FAILED,
    description: success ? '使用者登入成功' : `登入失敗: ${errorMsg || '未知原因'}`,
    ipAddress: ip,
    userAgent,
    success,
    errorMsg,
  });
}

/**
 * 記錄登出事件
 */
export async function logLogout(
  userId: number,
  employeeId: number,
  request: NextRequest
): Promise<void> {
  const { ip, userAgent } = getRequestInfo(request);
  await logAudit({
    userId,
    employeeId,
    action: AuditAction.LOGOUT,
    description: '使用者登出',
    ipAddress: ip,
    userAgent,
  });
}

/**
 * 記錄資料變更
 */
export async function logDataChange(
  userId: number,
  employeeId: number,
  action: AuditAction,
  targetType: AuditTargetType,
  targetId: number,
  oldValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null,
  request: NextRequest,
  description?: string
): Promise<void> {
  const { ip, userAgent } = getRequestInfo(request);
  await logAudit({
    userId,
    employeeId,
    action,
    targetType,
    targetId,
    oldValue,
    newValue,
    description,
    ipAddress: ip,
    userAgent,
  });
}

/**
 * 記錄敏感操作（如密碼變更、薪資修改）
 */
export async function logSensitiveAction(
  userId: number,
  employeeId: number,
  action: AuditAction,
  description: string,
  request: NextRequest,
  additionalInfo?: {
    targetType?: AuditTargetType;
    targetId?: number;
  }
): Promise<void> {
  const { ip, userAgent } = getRequestInfo(request);
  await logAudit({
    userId,
    employeeId,
    action,
    targetType: additionalInfo?.targetType,
    targetId: additionalInfo?.targetId,
    description,
    ipAddress: ip,
    userAgent,
  });
}

/**
 * 查詢操作日誌
 */
export async function queryAuditLogs(options: {
  userId?: number;
  employeeId?: number;
  action?: string;
  targetType?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const {
    userId,
    employeeId,
    action,
    targetType,
    startDate,
    endDate,
    success,
    page = 1,
    pageSize = 50,
  } = options;

  const where: Record<string, unknown> = {};

  if (userId) where.userId = userId;
  if (employeeId) where.employeeId = employeeId;
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;
  if (success !== undefined) where.success = success;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) (where.createdAt as Record<string, Date>).gte = startDate;
    if (endDate) (where.createdAt as Record<string, Date>).lte = endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
