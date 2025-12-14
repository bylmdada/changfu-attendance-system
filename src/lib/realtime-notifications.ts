/**
 * 📢 Real-time Notification System - 即時通知系統
 * 
 * 提供企業級即時通知功能，包含：
 * - WebSocket 連接管理
 * - 多通道通知分發
 * - 通知優先級管理
 * - 通知歷史記錄
 * - 即時狀態同步
 * 
 * @created 2024-11-10
 * @phase Phase 2C - 完整系統優化
 */




// 通知類型定義
export type NotificationType = 
  | 'SYSTEM_ALERT' 
  | 'ATTENDANCE_REMINDER' 
  | 'SCHEDULE_UPDATE'
  | 'LEAVE_APPROVAL'
  | 'PAYROLL_READY'
  | 'ANNOUNCEMENT'
  | 'SECURITY_ALERT'
  | 'MAINTENANCE';

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type NotificationChannel = 'WEB' | 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';

// 通知接口定義
export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  title: string;
  message: string;
  data?: Record<string, unknown>;
  targetUsers?: string[]; // 用戶 ID 陣列
  targetRoles?: string[]; // 角色陣列
  scheduledAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  createdBy: string;
  delivered: boolean;
  readBy: string[]; // 已讀用戶列表
}

// WebSocket 連接管理
interface WebSocketConnection {
  userId: string;
  connectionId: string;
  connectedAt: Date;
  lastActivity: Date;
  channels: string[];
  metadata: Record<string, unknown>;
}

// 通知統計
interface NotificationStats {
  totalNotifications: number;
  pendingNotifications: number;
  deliveredNotifications: number;
  unreadNotifications: number;
  notificationsByType: Record<NotificationType, number>;
  notificationsByPriority: Record<NotificationPriority, number>;
  averageDeliveryTime: number;
  activeConnections: number;
}

// 內存存儲 (生產環境應使用 Redis/Database)
const notifications: Map<string, Notification> = new Map();
const connections: Map<string, WebSocketConnection> = new Map();
const deliveryHistory: Array<{
  notificationId: string;
  userId: string;
  deliveredAt: Date;
  channel: NotificationChannel;
  success: boolean;
}> = [];

let notificationIdCounter = 1;

// 即時通知系統類
export class RealTimeNotificationSystem {
  private static instance: RealTimeNotificationSystem;
  private eventListeners: Map<string, Array<(data: unknown) => void>> = new Map();

  static getInstance(): RealTimeNotificationSystem {
    if (!this.instance) {
      this.instance = new RealTimeNotificationSystem();
    }
    return this.instance;
  }

  // 創建通知
  async createNotification(notification: Omit<Notification, 'id' | 'createdAt' | 'delivered' | 'readBy'>): Promise<string> {
    const id = `notification_${Date.now()}_${notificationIdCounter++}`;
    
    const newNotification: Notification = {
      ...notification,
      id,
      createdAt: new Date(),
      delivered: false,
      readBy: []
    };

    notifications.set(id, newNotification);

    // 記錄性能指標 (簡化版本)
    console.log(`📊 通知創建指標: ${id}, 類型: ${notification.type}`);

    // 如果是安全警報，記錄安全事件 (簡化版本)
    if (notification.type === 'SECURITY_ALERT') {
      console.log(`🚨 安全通知創建: ${id}, 標題: ${notification.title}`);
    }

    // 觸發通知事件
    this.emit('notification:created', newNotification);

    // 立即分發或排程分發
    if (!notification.scheduledAt || notification.scheduledAt <= new Date()) {
      await this.deliverNotification(id);
    }

    return id;
  }

  // 分發通知
  async deliverNotification(notificationId: string): Promise<boolean> {
    const notification = notifications.get(notificationId);
    if (!notification) {
      return false;
    }

    try {
      // 確定目標用戶
      const targetUsers = await this.resolveTargetUsers(notification);
      
      // 按通道分發
      const deliveryPromises = notification.channels.map(channel => 
        this.deliverToChannel(notification, targetUsers, channel)
      );

      await Promise.all(deliveryPromises);

      // 更新通知狀態
      notification.delivered = true;
      notifications.set(notificationId, notification);

      // 觸發分發完成事件
      this.emit('notification:delivered', notification);

      return true;
    } catch (error) {
      console.error('通知分發失敗:', error);
      return false;
    }
  }

  // 解析目標用戶
  private async resolveTargetUsers(notification: Notification): Promise<string[]> {
    let users: string[] = [];

    // 直接指定的用戶
    if (notification.targetUsers) {
      users.push(...notification.targetUsers);
    }

    // 按角色查找用戶 (這裡需要與用戶管理系統集成)
    if (notification.targetRoles) {
      // 模擬根據角色查找用戶
      const roleUsers = await this.getUsersByRoles(notification.targetRoles);
      users.push(...roleUsers);
    }

    // 如果沒有指定目標，則發送給所有連接的用戶 (廣播)
    if (users.length === 0) {
      users = Array.from(connections.keys());
    }

    return [...new Set(users)]; // 去重
  }

  // 根據角色獲取用戶 (模擬)
  private async getUsersByRoles(roles: string[]): Promise<string[]> {
    // 這裡應該與實際的用戶管理系統集成
    const mockUsers: Record<string, string[]> = {
      'ADMIN': ['admin1', 'admin2'],
      'HR': ['hr1', 'hr2'],
      'EMPLOYEE': ['emp1', 'emp2', 'emp3']
    };

    const users: string[] = [];
    roles.forEach(role => {
      if (mockUsers[role]) {
        users.push(...mockUsers[role]);
      }
    });

    return users;
  }

  // 按通道分發
  private async deliverToChannel(
    notification: Notification, 
    targetUsers: string[], 
    channel: NotificationChannel
  ): Promise<void> {
    for (const userId of targetUsers) {
      try {
        let success = false;

        switch (channel) {
          case 'WEB':
          case 'IN_APP':
            success = await this.deliverWebNotification(notification, userId);
            break;
          case 'EMAIL':
            success = await this.deliverEmailNotification(notification, userId);
            break;
          case 'SMS':
            success = await this.deliverSMSNotification(notification, userId);
            break;
          case 'PUSH':
            success = await this.deliverPushNotification(notification, userId);
            break;
        }

        // 記錄分發歷史
        deliveryHistory.push({
          notificationId: notification.id,
          userId,
          deliveredAt: new Date(),
          channel,
          success
        });

      } catch (error) {
        console.error(`通知分發失敗 [${channel}] -> ${userId}:`, error);
      }
    }
  }

  // Web/In-App 通知分發
  private async deliverWebNotification(notification: Notification, userId: string): Promise<boolean> {
    const connection = connections.get(userId);
    if (!connection) {
      return false; // 用戶未連接
    }

    // 模擬 WebSocket 發送
    console.log(`📱 發送 Web 通知給用戶 ${userId}:`, notification.title);
    
    // 觸發即時通知事件
    this.emit('notification:web', { notification, userId });
    
    return true;
  }

  // 郵件通知分發 (模擬)
  private async deliverEmailNotification(notification: Notification, userId: string): Promise<boolean> {
    // 這裡應該與實際的郵件服務集成
    console.log(`📧 發送郵件通知給用戶 ${userId}:`, notification.title);
    
    // 模擬郵件發送延遲
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return true;
  }

  // SMS 通知分發 (模擬)
  private async deliverSMSNotification(notification: Notification, userId: string): Promise<boolean> {
    // 這裡應該與實際的 SMS 服務集成
    console.log(`📱 發送 SMS 通知給用戶 ${userId}:`, notification.title);
    
    return true;
  }

  // 推播通知分發 (模擬)
  private async deliverPushNotification(notification: Notification, userId: string): Promise<boolean> {
    // 這裡應該與實際的推播服務集成
    console.log(`🔔 發送推播通知給用戶 ${userId}:`, notification.title);
    
    return true;
  }

  // 標記通知為已讀
  markAsRead(notificationId: string, userId: string): boolean {
    const notification = notifications.get(notificationId);
    if (!notification) {
      return false;
    }

    if (!notification.readBy.includes(userId)) {
      notification.readBy.push(userId);
      notifications.set(notificationId, notification);
      
      // 觸發已讀事件
      this.emit('notification:read', { notification, userId });
    }

    return true;
  }

  // WebSocket 連接管理
  addConnection(userId: string, metadata: Record<string, unknown> = {}): string {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const connection: WebSocketConnection = {
      userId,
      connectionId,
      connectedAt: new Date(),
      lastActivity: new Date(),
      channels: ['general', `user_${userId}`],
      metadata
    };

    connections.set(userId, connection);

    // 觸發連接事件
    this.emit('connection:established', connection);

    return connectionId;
  }

  // 移除連接
  removeConnection(userId: string): boolean {
    const connection = connections.get(userId);
    if (connection) {
      connections.delete(userId);
      
      // 觸發斷線事件
      this.emit('connection:closed', connection);
      
      return true;
    }
    return false;
  }

  // 更新連接活動時間
  updateConnectionActivity(userId: string): boolean {
    const connection = connections.get(userId);
    if (connection) {
      connection.lastActivity = new Date();
      connections.set(userId, connection);
      return true;
    }
    return false;
  }

  // 獲取統計資料
  getStats(): NotificationStats {
    const totalNotifications = notifications.size;
    const deliveredCount = Array.from(notifications.values()).filter(n => n.delivered).length;
    const pendingCount = totalNotifications - deliveredCount;
    
    // 計算未讀通知數
    let unreadCount = 0;
    notifications.forEach(notification => {
      if (notification.delivered && notification.readBy.length === 0) {
        unreadCount++;
      }
    });

    // 按類型統計
    const notificationsByType: Record<NotificationType, number> = {
      'SYSTEM_ALERT': 0,
      'ATTENDANCE_REMINDER': 0,
      'SCHEDULE_UPDATE': 0,
      'LEAVE_APPROVAL': 0,
      'PAYROLL_READY': 0,
      'ANNOUNCEMENT': 0,
      'SECURITY_ALERT': 0,
      'MAINTENANCE': 0
    };

    // 按優先級統計
    const notificationsByPriority: Record<NotificationPriority, number> = {
      'LOW': 0,
      'NORMAL': 0,
      'HIGH': 0,
      'URGENT': 0
    };

    notifications.forEach(notification => {
      notificationsByType[notification.type]++;
      notificationsByPriority[notification.priority]++;
    });

    // 計算平均分發時間
    const recentDeliveries = deliveryHistory.slice(-100);
    const avgDeliveryTime = recentDeliveries.length > 0 
      ? recentDeliveries.reduce((sum) => sum + 1, 0) / recentDeliveries.length
      : 0;

    return {
      totalNotifications,
      pendingNotifications: pendingCount,
      deliveredNotifications: deliveredCount,
      unreadNotifications: unreadCount,
      notificationsByType,
      notificationsByPriority,
      averageDeliveryTime: avgDeliveryTime,
      activeConnections: connections.size
    };
  }

  // 事件系統
  on(event: string, listener: (data: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  private emit(event: string, data: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`事件處理器錯誤 [${event}]:`, error);
        }
      });
    }
  }

  // 清理過期通知
  cleanup(): number {
    let cleanedCount = 0;
    const now = new Date();

    notifications.forEach((notification, id) => {
      if (notification.expiresAt && notification.expiresAt < now) {
        notifications.delete(id);
        cleanedCount++;
      }
    });

    // 清理舊的分發歷史 (保留最近 1000 條)
    if (deliveryHistory.length > 1000) {
      deliveryHistory.splice(0, deliveryHistory.length - 1000);
    }

    return cleanedCount;
  }
}

// 導出通知系統實例
export const notificationSystem = RealTimeNotificationSystem.getInstance();

// 預定義通知模板
export const NotificationTemplates = {
  // 系統維護通知
  systemMaintenance: (startTime: Date, duration: number): Omit<Notification, 'id' | 'createdAt' | 'delivered' | 'readBy'> => ({
    type: 'MAINTENANCE',
    priority: 'HIGH',
    channels: ['WEB', 'EMAIL', 'IN_APP'],
    title: '系統維護通知',
    message: `系統將於 ${startTime.toLocaleString('zh-TW')} 開始進行維護，預計耗時 ${duration} 分鐘。`,
    data: { startTime, duration },
    scheduledAt: new Date(startTime.getTime() - 30 * 60 * 1000), // 提前30分鐘通知
    createdBy: 'system'
  }),

  // 考勤提醒
  attendanceReminder: (userId: string): Omit<Notification, 'id' | 'createdAt' | 'delivered' | 'readBy'> => ({
    type: 'ATTENDANCE_REMINDER',
    priority: 'NORMAL',
    channels: ['WEB', 'IN_APP'],
    title: '考勤提醒',
    message: '別忘了打卡哦！請記得完成今日的考勤記錄。',
    targetUsers: [userId],
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小時後過期
    createdBy: 'system'
  }),

  // 安全警報
  securityAlert: (details: string): Omit<Notification, 'id' | 'createdAt' | 'delivered' | 'readBy'> => ({
    type: 'SECURITY_ALERT',
    priority: 'URGENT',
    channels: ['WEB', 'EMAIL', 'SMS', 'IN_APP'],
    title: '安全警報',
    message: `檢測到安全異常：${details}`,
    targetRoles: ['ADMIN'],
    data: { alertDetails: details },
    createdBy: 'security-system'
  })
};

// 便利函數
export async function sendNotification(
  notification: Omit<Notification, 'id' | 'createdAt' | 'delivered' | 'readBy'>
): Promise<string> {
  return await notificationSystem.createNotification(notification);
}

export function getNotificationById(id: string): Notification | undefined {
  return notifications.get(id);
}

export function getUserNotifications(userId: string, unreadOnly = false): Notification[] {
  const userNotifications = Array.from(notifications.values()).filter(notification => {
    const isTargetUser = notification.targetUsers?.includes(userId) || 
                        notification.targetUsers === undefined;
    
    if (unreadOnly) {
      return isTargetUser && !notification.readBy.includes(userId);
    }
    
    return isTargetUser;
  });

  return userNotifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
