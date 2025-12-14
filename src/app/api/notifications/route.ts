/**
 * 📢 Notification Management API - 通知管理 API
 * 
 * 提供即時通知系統的完整管理介面
 * 
 * @created 2024-11-10
 * @phase Phase 2C - 完整系統優化
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { 
  notificationSystem,
  sendNotification,
  getNotificationById,
  getUserNotifications,
  NotificationTemplates,
  type NotificationType,
  type NotificationPriority,
  type NotificationChannel
} from '@/lib/realtime-notifications';

// 通知管理 API - 獲取通知資料
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'user-notifications';
    const userId = searchParams.get('userId') || user.userId.toString();
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');

    switch (action) {
      case 'user-notifications':
        // 獲取用戶通知
        if (userId !== user.userId.toString() && user.role !== 'ADMIN') {
          return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const userNotifications = getUserNotifications(userId, unreadOnly);
        const limitedNotifications = userNotifications.slice(0, limit);

        return NextResponse.json({
          success: true,
          data: {
            notifications: limitedNotifications,
            totalCount: userNotifications.length,
            unreadCount: getUserNotifications(userId, true).length,
            hasMore: userNotifications.length > limit
          }
        });

      case 'notification-details':
        // 獲取通知詳情
        const notificationId = searchParams.get('id');
        if (!notificationId) {
          return NextResponse.json({ error: '需要提供通知 ID' }, { status: 400 });
        }

        const notification = getNotificationById(notificationId);
        if (!notification) {
          return NextResponse.json({ error: '找不到指定通知' }, { status: 404 });
        }

        // 檢查訪問權限
        const hasAccess = notification.targetUsers?.includes(userId) ||
                         notification.targetUsers === undefined ||
                         user.role === 'ADMIN';

        if (!hasAccess) {
          return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        return NextResponse.json({
          success: true,
          data: notification
        });

      case 'system-stats':
        // 系統統計 (僅管理員)
        if (user.role !== 'ADMIN') {
          return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
        }

        const stats = notificationSystem.getStats();

        return NextResponse.json({
          success: true,
          data: {
            stats,
            systemHealth: {
              healthy: stats.activeConnections > 0,
              averageDeliveryTime: stats.averageDeliveryTime,
              deliveryRate: stats.deliveredNotifications / Math.max(stats.totalNotifications, 1) * 100
            }
          }
        });

      case 'connection-status':
        // 連接狀態
        return NextResponse.json({
          success: true,
          data: {
            connected: true, // 模擬連接狀態
            userId,
            connectionTime: new Date().toISOString(),
            lastActivity: new Date().toISOString()
          }
        });

      case 'templates':
        // 獲取通知模板 (僅管理員和HR)
        if (!['ADMIN', 'HR'].includes(user.role)) {
          return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const templates = Object.keys(NotificationTemplates).map(key => ({
          name: key,
          description: getTemplateDescription(key)
        }));

        return NextResponse.json({
          success: true,
          data: { templates }
        });

      default:
        return NextResponse.json({ error: '不支援的操作類型' }, { status: 400 });
    }

  } catch (error) {
    console.error('通知管理錯誤:', error);
    return NextResponse.json({ error: '獲取通知資料時發生錯誤' }, { status: 500 });
  }
}

// 通知管理操作
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'send-notification':
        // 發送通知 (僅管理員和HR)
        if (!['ADMIN', 'HR'].includes(user.role)) {
          return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const {
          type,
          priority,
          channels,
          title,
          message,
          targetUsers,
          targetRoles,
          data,
          scheduledAt,
          expiresAt
        } = body;

        // 驗證必填欄位
        if (!type || !priority || !channels || !title || !message) {
          return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
        }

        // 驗證類型
        const validTypes: NotificationType[] = [
          'SYSTEM_ALERT', 'ATTENDANCE_REMINDER', 'SCHEDULE_UPDATE',
          'LEAVE_APPROVAL', 'PAYROLL_READY', 'ANNOUNCEMENT',
          'SECURITY_ALERT', 'MAINTENANCE'
        ];

        if (!validTypes.includes(type)) {
          return NextResponse.json({ error: '無效的通知類型' }, { status: 400 });
        }

        const newNotificationId = await sendNotification({
          type,
          priority: priority as NotificationPriority,
          channels: channels as NotificationChannel[],
          title,
          message,
          targetUsers,
          targetRoles,
          data,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
          createdBy: user.userId.toString()
        });

        return NextResponse.json({
          success: true,
          message: '通知發送成功',
          data: { notificationId: newNotificationId }
        });

      case 'mark-as-read':
        // 標記為已讀
        const { notificationId: targetNotificationId } = body;

        if (!targetNotificationId) {
          return NextResponse.json({ error: '需要提供通知 ID' }, { status: 400 });
        }

        const marked = notificationSystem.markAsRead(targetNotificationId, user.userId.toString());

        if (!marked) {
          return NextResponse.json({ error: '標記失敗，通知不存在' }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          message: '已標記為已讀'
        });

      case 'mark-all-as-read':
        // 標記所有通知為已讀
        const userNotifications = getUserNotifications(user.userId.toString(), true);
        let markedCount = 0;

        userNotifications.forEach(notification => {
          if (notificationSystem.markAsRead(notification.id, user.userId.toString())) {
            markedCount++;
          }
        });

        return NextResponse.json({
          success: true,
          message: `已標記 ${markedCount} 則通知為已讀`,
          data: { markedCount }
        });

      case 'send-template-notification':
        // 發送模板通知 (僅管理員和HR)
        if (!['ADMIN', 'HR'].includes(user.role)) {
          return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { templateName, templateData } = body;

        if (!templateName) {
          return NextResponse.json({ error: '需要提供模板名稱' }, { status: 400 });
        }

        let templateNotification;

        switch (templateName) {
          case 'systemMaintenance':
            if (!templateData?.startTime || !templateData?.duration) {
              return NextResponse.json({ error: '系統維護模板需要 startTime 和 duration 參數' }, { status: 400 });
            }
            templateNotification = NotificationTemplates.systemMaintenance(
              new Date(templateData.startTime),
              templateData.duration
            );
            break;

          case 'attendanceReminder':
            if (!templateData?.userId) {
              return NextResponse.json({ error: '考勤提醒模板需要 userId 參數' }, { status: 400 });
            }
            templateNotification = NotificationTemplates.attendanceReminder(templateData.userId);
            break;

          case 'securityAlert':
            if (!templateData?.details) {
              return NextResponse.json({ error: '安全警報模板需要 details 參數' }, { status: 400 });
            }
            templateNotification = NotificationTemplates.securityAlert(templateData.details);
            break;

          default:
            return NextResponse.json({ error: '不支援的模板類型' }, { status: 400 });
        }

        // 設定創建者
        templateNotification.createdBy = user.userId.toString();

        const templateNotificationId = await sendNotification(templateNotification);

        return NextResponse.json({
          success: true,
          message: '模板通知發送成功',
          data: { 
            notificationId: templateNotificationId,
            template: templateName 
          }
        });

      case 'connect':
        // 建立 WebSocket 連接 (模擬)
        const connectionId = notificationSystem.addConnection(user.userId.toString(), {
          userAgent: request.headers.get('user-agent'),
          ip: request.headers.get('x-forwarded-for') || 'unknown'
        });

        return NextResponse.json({
          success: true,
          message: '連接建立成功',
          data: { connectionId }
        });

      case 'disconnect':
        // 斷開連接
        const disconnected = notificationSystem.removeConnection(user.userId.toString());

        return NextResponse.json({
          success: true,
          message: disconnected ? '連接已斷開' : '連接不存在',
          data: { disconnected }
        });

      case 'cleanup':
        // 清理過期通知 (僅管理員)
        if (user.role !== 'ADMIN') {
          return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
        }

        const cleanedCount = notificationSystem.cleanup();

        return NextResponse.json({
          success: true,
          message: `已清理 ${cleanedCount} 則過期通知`,
          data: { cleanedCount }
        });

      default:
        return NextResponse.json({ error: '不支援的操作類型' }, { status: 400 });
    }

  } catch (error) {
    console.error('通知操作錯誤:', error);
    return NextResponse.json({ error: '執行通知操作時發生錯誤' }, { status: 500 });
  }
}

// 獲取模板描述
function getTemplateDescription(templateName: string): string {
  const descriptions: Record<string, string> = {
    systemMaintenance: '系統維護通知模板 - 用於通知用戶系統維護時間',
    attendanceReminder: '考勤提醒模板 - 提醒員工完成打卡',
    securityAlert: '安全警報模板 - 用於安全事件通知'
  };

  return descriptions[templateName] || '未知模板';
}
