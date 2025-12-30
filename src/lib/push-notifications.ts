/**
 * 📢 Web Push 推播通知服務
 * 
 * 使用 Web Push API 發送 PWA 推播通知
 * 
 * @created 2024-12-23
 */

import webpush from 'web-push';
import { prisma } from '@/lib/database';
import { systemLogger } from '@/lib/logger';

// VAPID 金鑰配置
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BBfFGPggYk_u3VQE-jO_1l8WhO3Z2UprKsEhvupcC2EcrgJN9m5y4wW4-sLMJf7Qf5n9b3u4PEEnso6KRmAnZTI';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '2jnih7vSYAZSdX1bA6N9dH4KEYWu93wHcjBIzpXnJus';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@changfu.org';

// 初始化 VAPID
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// 推播通知類型
export type PushNotificationType = 
  | 'ATTENDANCE_REMINDER'   // 打卡提醒
  | 'MISSED_CLOCK'          // 漏打卡提醒
  | 'OVERTIME_WARNING'      // 加班超限
  | 'LEAVE_APPROVED'        // 請假核准
  | 'LEAVE_REJECTED'        // 請假拒絕
  | 'ANNOUNCEMENT'          // 系統公告
  | 'SHIFT_CHANGE'          // 班表變更
  | 'TEST';                 // 測試通知

// 推播訂閱介面
export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// 推播通知內容
export interface PushNotificationPayload {
  type: PushNotificationType;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    actions?: Array<{
      action: string;
      title: string;
    }>;
    [key: string]: unknown;
  };
}

/**
 * 取得 VAPID 公鑰（用於前端訂閱）
 */
export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

/**
 * 儲存推播訂閱
 */
export async function savePushSubscription(
  userId: number,
  subscription: PushSubscriptionData
): Promise<boolean> {
  try {
    // 先查找用戶對應的員工
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true }
    });

    if (!user?.employeeId) {
      return false;
    }

    // 使用 NotificationSettings 來儲存推播訂閱資訊
    await prisma.notificationSettings.upsert({
      where: { employeeId: user.employeeId },
      update: {
        pushEnabled: true,
        pushEndpoint: subscription.endpoint,
        pushP256dh: subscription.keys.p256dh,
        pushAuth: subscription.keys.auth,
        updatedAt: new Date()
      },
      create: {
        employeeId: user.employeeId,
        pushEnabled: true,
        pushEndpoint: subscription.endpoint,
        pushP256dh: subscription.keys.p256dh,
        pushAuth: subscription.keys.auth
      }
    });

    systemLogger.info(`推播訂閱已儲存: 用戶 ${userId}`, {
      userId,
      context: { endpoint: subscription.endpoint.substring(0, 50) + '...' }
    });

    return true;
  } catch (error) {
    systemLogger.error('儲存推播訂閱失敗', {
      error: error instanceof Error ? error : new Error(String(error)),
      userId,
      context: { endpoint: subscription.endpoint }
    });
    return false;
  }
}

/**
 * 移除推播訂閱
 */
export async function removePushSubscription(userId: number): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true }
    });

    if (!user?.employeeId) {
      return false;
    }

    await prisma.notificationSettings.update({
      where: { employeeId: user.employeeId },
      data: {
        pushEnabled: false,
        pushEndpoint: null,
        pushP256dh: null,
        pushAuth: null
      }
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * 發送推播通知給單一用戶
 */
export async function sendPushNotification(
  employeeId: number,
  payload: PushNotificationPayload
): Promise<boolean> {
  try {
    const settings = await prisma.notificationSettings.findUnique({
      where: { employeeId },
      select: {
        pushEnabled: true,
        pushEndpoint: true,
        pushP256dh: true,
        pushAuth: true
      }
    });

    if (!settings?.pushEnabled || !settings.pushEndpoint || !settings.pushP256dh || !settings.pushAuth) {
      return false; // 用戶未啟用推播或無訂閱
    }

    const subscription: webpush.PushSubscription = {
      endpoint: settings.pushEndpoint,
      keys: {
        p256dh: settings.pushP256dh,
        auth: settings.pushAuth
      }
    };

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/icon-72x72.png',
      tag: payload.tag || payload.type,
      data: {
        type: payload.type,
        url: payload.data?.url || '/',
        ...payload.data
      }
    });

    await webpush.sendNotification(subscription, notificationPayload);
    
    systemLogger.info(`推播通知已發送: 員工 ${employeeId}`, {
      employeeId,
      context: { type: payload.type, title: payload.title }
    });

    return true;
  } catch (error) {
    // 如果訂閱無效，自動移除
    if (error instanceof webpush.WebPushError && error.statusCode === 410) {
      await prisma.notificationSettings.update({
        where: { employeeId },
        data: {
          pushEnabled: false,
          pushEndpoint: null,
          pushP256dh: null,
          pushAuth: null
        }
      });
      systemLogger.warn(`推播訂閱已過期並移除: 員工 ${employeeId}`, { employeeId });
    } else {
      systemLogger.error('發送推播通知失敗', {
        error: error instanceof Error ? error : new Error(String(error)),
        employeeId,
        context: { type: payload.type }
      });
    }
    return false;
  }
}

/**
 * 批量發送推播通知
 */
export async function sendBulkPushNotification(
  employeeIds: number[],
  payload: PushNotificationPayload
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const employeeId of employeeIds) {
    const result = await sendPushNotification(employeeId, payload);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  return { success, failed };
}

/**
 * 發送打卡提醒
 */
export async function sendAttendanceReminder(employeeId: number): Promise<boolean> {
  return sendPushNotification(employeeId, {
    type: 'ATTENDANCE_REMINDER',
    title: '⏰ 打卡提醒',
    body: '別忘了打卡哦！請記得完成今日的考勤記錄。',
    data: {
      url: '/attendance',
      actions: [
        { action: 'clock_in', title: '立即打卡' }
      ]
    }
  });
}

/**
 * 發送漏打卡提醒
 */
export async function sendMissedClockReminder(
  employeeId: number,
  clockType: 'IN' | 'OUT'
): Promise<boolean> {
  const message = clockType === 'IN' 
    ? '您今日尚未上班打卡，如需補打卡請提交申請。'
    : '您今日尚未下班打卡，請記得完成下班打卡。';

  return sendPushNotification(employeeId, {
    type: 'MISSED_CLOCK',
    title: '⚠️ 漏打卡提醒',
    body: message,
    data: {
      url: '/attendance',
      clockType
    }
  });
}

/**
 * 發送加班超限警示
 */
export async function sendOvertimeWarningPush(
  employeeId: number,
  totalHours: number,
  alertLevel: 'WARNING' | 'CRITICAL'
): Promise<boolean> {
  const emoji = alertLevel === 'CRITICAL' ? '🔴' : '🟡';
  const limit = alertLevel === 'CRITICAL' ? 46 : 40;

  return sendPushNotification(employeeId, {
    type: 'OVERTIME_WARNING',
    title: `${emoji} 加班時數警示`,
    body: `您本月加班已達 ${totalHours.toFixed(1)} 小時，${alertLevel === 'CRITICAL' ? '已超過法定上限' : '接近警戒線'}（${limit}小時）`,
    data: {
      url: '/reports/overtime-statistics',
      totalHours,
      alertLevel,
      limit
    }
  });
}

/**
 * 發送請假核准通知
 */
export async function sendLeaveApprovalPush(
  employeeId: number,
  approved: boolean,
  leaveType: string,
  dates: string
): Promise<boolean> {
  return sendPushNotification(employeeId, {
    type: approved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
    title: approved ? '✅ 請假已核准' : '❌ 請假被拒絕',
    body: `您的${leaveType}申請（${dates}）已${approved ? '核准' : '被拒絕'}。`,
    data: {
      url: '/leave-requests',
      approved,
      leaveType
    }
  });
}

/**
 * 發送測試推播
 */
export async function sendTestPush(employeeId: number): Promise<boolean> {
  return sendPushNotification(employeeId, {
    type: 'TEST',
    title: '🔔 測試推播通知',
    body: '這是一則測試通知，如果您看到此訊息表示推播設定成功！',
    data: {
      url: '/settings/notifications'
    }
  });
}
