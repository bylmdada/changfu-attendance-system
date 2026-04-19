/**
 * 📧 通用郵件發送工具
 * 
 * 提供統一的郵件發送介面，支援：
 * - SMTP 郵件發送
 * - 系統內通知
 * - 郵件模板管理
 * 
 * @created 2024-12-22
 */

import nodemailer from 'nodemailer';
import { prisma } from '@/lib/database';

// 郵件通知類型
export type NotificationType = 
  | 'LEAVE_APPROVED'      // 請假核准
  | 'LEAVE_REJECTED'      // 請假拒絕
  | 'OVERTIME_APPROVED'   // 加班核准
  | 'OVERTIME_REJECTED'   // 加班拒絕
  | 'SHIFT_APPROVED'      // 換班核准
  | 'SHIFT_REJECTED'      // 換班拒絕
  | 'ANNUAL_LEAVE_EXPIRY' // 年假到期提醒
  | 'PAYSLIP_SENT'        // 薪資單發送
  | 'SYSTEM_ANNOUNCEMENT' // 系統公告
  | 'GENERAL';            // 一般通知

// 通知渠道
export type NotificationChannel = 'EMAIL' | 'IN_APP' | 'BOTH';

// 郵件配置介面
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
}

// 郵件內容介面
interface EmailContent {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function normalizeConfigString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function getSafeEmailErrorMessage() {
  return '郵件發送失敗，請檢查 SMTP 設定後再試';
}

function getSafeEmailErrorLog(error: unknown) {
  const safeLog: {
    code?: string;
    responseCode?: number;
  } = {};

  if (error && typeof error === 'object') {
    const maybeError = error as { code?: unknown; responseCode?: unknown };

    if (typeof maybeError.code === 'string') {
      safeLog.code = maybeError.code;
    }

    if (typeof maybeError.responseCode === 'number') {
      safeLog.responseCode = maybeError.responseCode;
    }
  }

  return safeLog;
}

// 通知內容介面
export interface NotificationContent {
  type: NotificationType;
  recipientEmployeeId: number;
  recipientEmail?: string;
  recipientName: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

// 通知設定介面
interface NotificationSettings {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  leaveApprovalNotify: boolean;
  overtimeApprovalNotify: boolean;
  shiftApprovalNotify: boolean;
  annualLeaveExpiryNotify: boolean;
  annualLeaveExpiryDays: number; // 提前幾天提醒
}

// 預設設定（預設只啟用系統內通知）
const DEFAULT_SETTINGS: NotificationSettings = {
  emailEnabled: false,        // 預設不啟用郵件
  inAppEnabled: true,         // 預設啟用系統內通知
  leaveApprovalNotify: true,
  overtimeApprovalNotify: true,
  shiftApprovalNotify: true,
  annualLeaveExpiryNotify: true,
  annualLeaveExpiryDays: 30,  // 提前30天提醒
};

/**
 * 取得郵件配置
 */
async function getEmailConfig(): Promise<EmailConfig | null> {
  try {
    // 嘗試從系統設定取得 SMTP 配置
    const smtpSettings = await prisma.smtpSettings.findFirst();

    const smtpHost = normalizeConfigString(smtpSettings?.smtpHost);
    const smtpUser = normalizeConfigString(smtpSettings?.smtpUser);
    const smtpPassword = typeof smtpSettings?.smtpPassword === 'string' && smtpSettings.smtpPassword !== ''
      ? smtpSettings.smtpPassword
      : null;

    if (!smtpSettings || !smtpHost || !smtpUser || !smtpPassword) {
      return null;
    }

    return {
      host: smtpHost,
      port: smtpSettings.smtpPort ?? 587,
      secure: smtpSettings.smtpSecure ?? false,
      user: smtpUser,
      password: smtpPassword,
      fromName: normalizeConfigString(smtpSettings.fromName) || '長福考勤系統',
      fromEmail: normalizeConfigString(smtpSettings.fromEmail) || smtpUser,
    };
  } catch (error) {
    console.error('取得郵件配置失敗:', error);
    return null;
  }
}

/**
 * 取得通知設定
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const settings = await prisma.systemNotificationSettings.findFirst();
    
    if (!settings) {
      return DEFAULT_SETTINGS;
    }

    return {
      emailEnabled: settings.emailEnabled ?? DEFAULT_SETTINGS.emailEnabled,
      inAppEnabled: settings.inAppEnabled ?? DEFAULT_SETTINGS.inAppEnabled,
      leaveApprovalNotify: settings.leaveApprovalNotify ?? DEFAULT_SETTINGS.leaveApprovalNotify,
      overtimeApprovalNotify: settings.overtimeApprovalNotify ?? DEFAULT_SETTINGS.overtimeApprovalNotify,
      shiftApprovalNotify: settings.shiftApprovalNotify ?? DEFAULT_SETTINGS.shiftApprovalNotify,
      annualLeaveExpiryNotify: settings.annualLeaveExpiryNotify ?? DEFAULT_SETTINGS.annualLeaveExpiryNotify,
      annualLeaveExpiryDays: settings.annualLeaveExpiryDays ?? DEFAULT_SETTINGS.annualLeaveExpiryDays,
    };
  } catch (error) {
    console.error('取得通知設定失敗:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * 發送郵件
 */
async function sendEmail(content: EmailContent): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await getEmailConfig();
    
    if (!config) {
      return { success: false, error: 'SMTP 未設定' };
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });

    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: content.to,
      subject: content.subject,
      text: content.text,
      html: content.html || content.text.replace(/\n/g, '<br>'),
    });

    return { success: true };
  } catch (error) {
    console.error('郵件發送失敗:', getSafeEmailErrorLog(error));
    return { 
      success: false, 
      error: getSafeEmailErrorMessage()
    };
  }
}

/**
 * 發送系統內通知
 */
async function sendInAppNotification(content: NotificationContent): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.inAppNotification.create({
      data: {
        employeeId: content.recipientEmployeeId,
        type: content.type,
        title: content.title,
        message: content.message,
        data: content.data ? JSON.stringify(content.data) : null,
        isRead: false,
        createdAt: new Date(),
      },
    });

    return { success: true };
  } catch (error) {
    console.error('系統內通知發送失敗:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : '系統內通知發送失敗' 
    };
  }
}

/**
 * 發送通知（統一入口）
 * 根據設定決定發送郵件、系統內通知或兩者
 */
export async function sendNotification(
  content: NotificationContent,
  channel?: NotificationChannel
): Promise<{ success: boolean; emailSent: boolean; inAppSent: boolean; errors: string[] }> {
  const settings = await getNotificationSettings();
  const errors: string[] = [];
  let emailSent = false;
  let inAppSent = false;

  // 根據通知類型檢查是否啟用
  const shouldNotify = checkNotificationType(content.type, settings);
  
  if (!shouldNotify) {
    return { success: true, emailSent: false, inAppSent: false, errors: [] };
  }

  // 決定發送渠道
  const sendEmail_ = channel === 'EMAIL' || channel === 'BOTH' || 
    (channel === undefined && settings.emailEnabled);
  const sendInApp = channel === 'IN_APP' || channel === 'BOTH' || 
    (channel === undefined && settings.inAppEnabled);

  // 發送郵件
  if (sendEmail_ && content.recipientEmail) {
    const emailResult = await sendEmail({
      to: content.recipientEmail,
      subject: content.title,
      text: content.message,
    });
    
    emailSent = emailResult.success;
    if (!emailResult.success && emailResult.error) {
      errors.push(`郵件: ${emailResult.error}`);
    }
  }

  // 發送系統內通知
  if (sendInApp) {
    const inAppResult = await sendInAppNotification(content);
    
    inAppSent = inAppResult.success;
    if (!inAppResult.success && inAppResult.error) {
      errors.push(`系統內通知: ${inAppResult.error}`);
    }
  }

  return {
    success: emailSent || inAppSent || errors.length === 0,
    emailSent,
    inAppSent,
    errors,
  };
}

/**
 * 檢查通知類型是否啟用
 */
function checkNotificationType(type: NotificationType, settings: NotificationSettings): boolean {
  switch (type) {
    case 'LEAVE_APPROVED':
    case 'LEAVE_REJECTED':
      return settings.leaveApprovalNotify;
    case 'OVERTIME_APPROVED':
    case 'OVERTIME_REJECTED':
      return settings.overtimeApprovalNotify;
    case 'SHIFT_APPROVED':
    case 'SHIFT_REJECTED':
      return settings.shiftApprovalNotify;
    case 'ANNUAL_LEAVE_EXPIRY':
      return settings.annualLeaveExpiryNotify;
    default:
      return true;
  }
}

// ==================== 便捷函數 ====================

/**
 * 發送請假審核結果通知
 */
export async function notifyLeaveApproval(params: {
  employeeId: number;
  employeeName: string;
  employeeEmail?: string;
  approved: boolean;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<void> {
  const { employeeId, employeeName, employeeEmail, approved, leaveType, startDate, endDate, reason } = params;
  
  const title = approved ? '請假申請已核准' : '請假申請已拒絕';
  const message = approved
    ? `您的${leaveType}申請（${startDate} ~ ${endDate}）已獲核准。`
    : `您的${leaveType}申請（${startDate} ~ ${endDate}）已被拒絕。${reason ? `原因：${reason}` : ''}`;

  await sendNotification({
    type: approved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
    recipientEmployeeId: employeeId,
    recipientEmail: employeeEmail,
    recipientName: employeeName,
    title,
    message,
    data: { leaveType, startDate, endDate, approved, reason },
  });
}

/**
 * 發送加班審核結果通知
 */
export async function notifyOvertimeApproval(params: {
  employeeId: number;
  employeeName: string;
  employeeEmail?: string;
  approved: boolean;
  overtimeDate: string;
  hours: number;
  reason?: string;
}): Promise<void> {
  const { employeeId, employeeName, employeeEmail, approved, overtimeDate, hours, reason } = params;
  
  const title = approved ? '加班申請已核准' : '加班申請已拒絕';
  const message = approved
    ? `您的加班申請（${overtimeDate}，${hours}小時）已獲核准。`
    : `您的加班申請（${overtimeDate}，${hours}小時）已被拒絕。${reason ? `原因：${reason}` : ''}`;

  await sendNotification({
    type: approved ? 'OVERTIME_APPROVED' : 'OVERTIME_REJECTED',
    recipientEmployeeId: employeeId,
    recipientEmail: employeeEmail,
    recipientName: employeeName,
    title,
    message,
    data: { overtimeDate, hours, approved, reason },
  });
}

/**
 * 發送換班審核結果通知
 */
export async function notifyShiftApproval(params: {
  employeeId: number;
  employeeName: string;
  employeeEmail?: string;
  approved: boolean;
  originalDate: string;
  targetDate: string;
  reason?: string;
}): Promise<void> {
  const { employeeId, employeeName, employeeEmail, approved, originalDate, targetDate, reason } = params;
  
  const title = approved ? '換班申請已核准' : '換班申請已拒絕';
  const message = approved
    ? `您的換班申請（${originalDate} ↔ ${targetDate}）已獲核准。`
    : `您的換班申請（${originalDate} ↔ ${targetDate}）已被拒絕。${reason ? `原因：${reason}` : ''}`;

  await sendNotification({
    type: approved ? 'SHIFT_APPROVED' : 'SHIFT_REJECTED',
    recipientEmployeeId: employeeId,
    recipientEmail: employeeEmail,
    recipientName: employeeName,
    title,
    message,
    data: { originalDate, targetDate, approved, reason },
  });
}

/**
 * 發送年假到期提醒
 */
export async function notifyAnnualLeaveExpiry(params: {
  employeeId: number;
  employeeName: string;
  employeeEmail?: string;
  remainingDays: number;
  expiryDate: string;
}): Promise<void> {
  const { employeeId, employeeName, employeeEmail, remainingDays, expiryDate } = params;
  
  const title = '年假即將到期提醒';
  const message = `您尚有 ${remainingDays} 天年假將於 ${expiryDate} 到期，請儘早安排休假。`;

  await sendNotification({
    type: 'ANNUAL_LEAVE_EXPIRY',
    recipientEmployeeId: employeeId,
    recipientEmail: employeeEmail,
    recipientName: employeeName,
    title,
    message,
    data: { remainingDays, expiryDate },
  });
}

// ==================== 分階段年假提醒 ====================

// 預設提醒階段設定
const DEFAULT_REMINDER_STAGES = [
  { stage: 1, daysFrom: 90, daysTo: 60, intervalDays: 30, label: '提前規劃' },
  { stage: 2, daysFrom: 60, daysTo: 30, intervalDays: 14, label: '督促安排' },
  { stage: 3, daysFrom: 30, daysTo: 7, intervalDays: 7, label: '加緊提醒' },
  { stage: 4, daysFrom: 7, daysTo: 0, intervalDays: 1, label: '緊急提醒' },
];

export interface ReminderStage {
  stage: number;
  daysFrom: number;
  daysTo: number;
  intervalDays: number;
  label: string;
}

/**
 * 取得提醒階段設定
 */
export async function getReminderStages(): Promise<ReminderStage[]> {
  try {
    const settings = await prisma.systemNotificationSettings.findFirst();
    if (settings?.reminderStages) {
      return JSON.parse(settings.reminderStages);
    }
  } catch (error) {
    console.error('取得提醒階段設定失敗:', error);
  }
  return DEFAULT_REMINDER_STAGES;
}

/**
 * 計算員工當前所在的提醒階段
 */
function getCurrentStage(daysUntilExpiry: number, stages: ReminderStage[]): ReminderStage | null {
  for (const stage of stages) {
    if (daysUntilExpiry <= stage.daysFrom && daysUntilExpiry > stage.daysTo) {
      return stage;
    }
  }
  // 檢查最後階段（包含到期日）
  const lastStage = stages[stages.length - 1];
  if (lastStage && daysUntilExpiry <= lastStage.daysFrom && daysUntilExpiry >= 0) {
    return lastStage;
  }
  return null;
}

/**
 * 檢查是否應該發送提醒（根據上次發送時間和頻率）
 */
async function shouldSendReminder(
  employeeId: number,
  annualLeaveId: number,
  stage: number,
  intervalDays: number
): Promise<boolean> {
  try {
    // 檢查該階段是否已經發送過
    const existingLog = await prisma.leaveExpiryReminderLog.findUnique({
      where: {
        employeeId_annualLeaveId_stage: {
          employeeId,
          annualLeaveId,
          stage,
        },
      },
    });

    if (!existingLog) {
      // 該階段從未發送過
      return true;
    }

    // 檢查距離上次發送是否超過間隔天數
    const daysSinceLastSent = Math.floor(
      (Date.now() - existingLog.sentAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return daysSinceLastSent >= intervalDays;
  } catch (error) {
    console.error('檢查提醒記錄失敗:', error);
    return true; // 出錯時預設發送
  }
}

/**
 * 記錄提醒發送
 */
async function logReminderSent(
  employeeId: number,
  annualLeaveId: number,
  year: number,
  stage: number,
  channel: string
): Promise<void> {
  try {
    await prisma.leaveExpiryReminderLog.upsert({
      where: {
        employeeId_annualLeaveId_stage: {
          employeeId,
          annualLeaveId,
          stage,
        },
      },
      update: {
        sentAt: new Date(),
        channel,
      },
      create: {
        employeeId,
        annualLeaveId,
        year,
        stage,
        channel,
      },
    });
  } catch (error) {
    console.error('記錄提醒發送失敗:', error);
  }
}

/**
 * 發送年假到期提醒（帶階段資訊）
 */
export async function notifyAnnualLeaveExpiryWithStage(params: {
  employeeId: number;
  employeeName: string;
  employeeEmail?: string;
  remainingDays: number;
  expiryDate: string;
  daysUntilExpiry: number;
  stageLabel: string;
}): Promise<void> {
  const { employeeId, employeeName, employeeEmail, remainingDays, expiryDate, daysUntilExpiry, stageLabel } = params;
  
  let urgencyText = '';
  if (daysUntilExpiry <= 7) {
    urgencyText = '⚠️ 緊急：';
  } else if (daysUntilExpiry <= 30) {
    urgencyText = '⏰ 提醒：';
  }

  const title = `${urgencyText}年假即將到期提醒`;
  const message = `${employeeName} 您好，\n\n您尚有 ${remainingDays} 天年假將於 ${expiryDate} 到期（剩餘 ${daysUntilExpiry} 天），請儘早安排休假。\n\n提醒類型：${stageLabel}`;

  await sendNotification({
    type: 'ANNUAL_LEAVE_EXPIRY',
    recipientEmployeeId: employeeId,
    recipientEmail: employeeEmail,
    recipientName: employeeName,
    title,
    message,
    data: { remainingDays, expiryDate, daysUntilExpiry, stageLabel },
  });
}

/**
 * 批量發送年假到期提醒（分階段版本）
 */
export async function sendAnnualLeaveExpiryReminders(): Promise<{
  sent: number;
  skipped: number;
  failed: number;
  details: { employeeName: string; stage: string; status: string }[];
  errors: string[];
}> {
  const settings = await getNotificationSettings();
  
  if (!settings.annualLeaveExpiryNotify) {
    return { sent: 0, skipped: 0, failed: 0, details: [], errors: [] };
  }

  const results = { 
    sent: 0, 
    skipped: 0, 
    failed: 0, 
    details: [] as { employeeName: string; stage: string; status: string }[],
    errors: [] as string[] 
  };
  
  try {
    const stages = await getReminderStages();
    const maxDays = Math.max(...stages.map(s => s.daysFrom));
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const reminderDate = new Date(today);
    reminderDate.setDate(today.getDate() + maxDays);

    // 查詢即將到期的年假
    const expiringLeaves = await prisma.annualLeave.findMany({
      where: {
        expiryDate: {
          gte: today,
          lte: reminderDate,
        },
        remainingDays: {
          gt: 0,
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    for (const leave of expiringLeaves) {
      const expiryDate = new Date(leave.expiryDate);
      expiryDate.setHours(0, 0, 0, 0);
      const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      // 確定當前階段
      const currentStage = getCurrentStage(daysUntilExpiry, stages);
      
      if (!currentStage) {
        results.details.push({
          employeeName: leave.employee.name,
          stage: '-',
          status: '不在提醒範圍內',
        });
        continue;
      }

      // 檢查是否應該發送
      const shouldSend = await shouldSendReminder(
        leave.employee.id,
        leave.id,
        currentStage.stage,
        currentStage.intervalDays
      );

      if (!shouldSend) {
        results.skipped++;
        results.details.push({
          employeeName: leave.employee.name,
          stage: currentStage.label,
          status: '已在間隔內發送過',
        });
        continue;
      }

      try {
        await notifyAnnualLeaveExpiryWithStage({
          employeeId: leave.employee.id,
          employeeName: leave.employee.name,
          employeeEmail: leave.employee.email || undefined,
          remainingDays: leave.remainingDays,
          expiryDate: leave.expiryDate.toISOString().split('T')[0],
          daysUntilExpiry,
          stageLabel: currentStage.label,
        });

        // 記錄發送
        await logReminderSent(
          leave.employee.id,
          leave.id,
          leave.year,
          currentStage.stage,
          settings.emailEnabled && settings.inAppEnabled ? 'BOTH' : 
            settings.emailEnabled ? 'EMAIL' : 'IN_APP'
        );

        results.sent++;
        results.details.push({
          employeeName: leave.employee.name,
          stage: currentStage.label,
          status: '已發送',
        });
      } catch (error) {
        results.failed++;
        results.details.push({
          employeeName: leave.employee.name,
          stage: currentStage.label,
          status: '發送失敗',
        });
        results.errors.push(`${leave.employee.name}: ${error instanceof Error ? error.message : '發送失敗'}`);
      }
    }
  } catch (error) {
    console.error('批量發送年假提醒失敗:', error);
    results.errors.push(error instanceof Error ? error.message : '系統錯誤');
  }

  return results;
}
