'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface InAppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationResponse {
  success: boolean;
  notifications: InAppNotification[];
  total: number;
  unreadCount: number;
}

const POLL_INTERVAL_MS = 60_000;

const NOTIFICATION_PATHS: Record<string, string> = {
  LEAVE_APPROVED: '/leave-management',
  LEAVE_REJECTED: '/leave-management',
  LEAVE_REQUEST: '/leave-management',
  OVERTIME_APPROVED: '/overtime-management',
  OVERTIME_REJECTED: '/overtime-management',
  OVERTIME_REQUEST: '/overtime-management',
  MISSED_CLOCK: '/missed-clock',
  SHIFT_APPROVED: '/shift-exchange',
  SHIFT_REJECTED: '/shift-exchange',
  SHIFT_REQUEST: '/shift-exchange',
  ANNUAL_LEAVE_EXPIRY: '/my-annual-leave',
  COMP_LEAVE_EXPIRY: '/my-comp-leave',
  PAYROLL_READY: '/employee-payroll',
  ANNOUNCEMENT: '/announcements/view',
  APPROVAL: '/approval-dashboard',
  APPROVAL_RESULT: '/approval-dashboard',
  APPROVAL_REMINDER: '/approval-dashboard',
  SECURITY_ALERT: '/system-monitoring',
  FREEZE_REMINDER: '/attendance-freeze',
};

function formatUnreadCount(count: number) {
  return count > 99 ? '99+' : String(count);
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMinutes < 1) return '剛剛';
  if (diffMinutes < 60) return `${diffMinutes} 分鐘前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小時前`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;

  return new Date(value).toLocaleDateString('zh-TW');
}

function getNotificationPath(notification: InAppNotification) {
  const dataPath = notification.data?.path ?? notification.data?.url ?? notification.data?.href;
  if (typeof dataPath === 'string' && dataPath.startsWith('/')) {
    return dataPath;
  }

  if (notification.type === 'APPROVAL_RESULT' && typeof notification.data?.requestType === 'string') {
    const requestId = typeof notification.data.requestId === 'number' ? notification.data.requestId : undefined;
    const resultPaths: Record<string, string> = {
      LEAVE: requestId ? `/leave-management?id=${requestId}` : '/leave-management',
      OVERTIME: requestId ? `/overtime-management?id=${requestId}` : '/overtime-management',
      MISSED_CLOCK: requestId ? `/missed-clock?id=${requestId}` : '/missed-clock',
      SHIFT_CHANGE: '/schedule-management',
      SHIFT_SWAP: '/shift-exchange',
      PURCHASE: requestId ? `/purchase-requests?id=${requestId}` : '/purchase-requests',
      RESIGNATION: requestId ? `/resignation-management?id=${requestId}` : '/resignation-management',
      PAYROLL_DISPUTE: requestId ? `/payroll-disputes?id=${requestId}` : '/payroll-disputes',
      DEPENDENT_APP: requestId ? `/health-insurance-dependents?id=${requestId}` : '/health-insurance-dependents',
      ANNOUNCEMENT: requestId ? `/announcements/view?id=${requestId}` : '/announcements/view',
      PENSION_CONTRIBUTION: '/pension-contribution',
    };

    return resultPaths[notification.data.requestType] ?? '/notifications';
  }

  return NOTIFICATION_PATHS[notification.type] ?? '/notifications';
}

export default function NotificationBell() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);

  const loadNotifications = useCallback(async (limit = 20) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/in-app-notifications?limit=${limit}`, {
        credentials: 'include',
      });

      if (!response.ok) return;

      const data = await response.json() as NotificationResponse;
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
    } catch (error) {
      console.error('讀取通知失敗:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await fetch('/api/in-app-notifications?unreadOnly=true&limit=1', {
        credentials: 'include',
      });

      if (!response.ok) return;

      const data = await response.json() as NotificationResponse;
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
    } catch (error) {
      console.error('讀取未讀通知數失敗:', error);
    }
  }, []);

  useEffect(() => {
    void loadUnreadCount();
    const timer = window.setInterval(() => {
      void loadUnreadCount();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [loadUnreadCount]);

  useEffect(() => {
    if (!isOpen) return;

    void loadNotifications();

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, loadNotifications]);

  const markAsRead = async (notificationId: number) => {
    const response = await fetchJSONWithCSRF('/api/in-app-notifications', {
      method: 'POST',
      body: {
        action: 'markAsRead',
        notificationIds: [notificationId],
      },
    });

    if (response.ok) {
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? { ...notification, isRead: true }
            : notification
        )
      );
      setUnreadCount((current) => Math.max(0, current - 1));
    }
  };

  const markAllAsRead = async () => {
    const response = await fetchJSONWithCSRF('/api/in-app-notifications', {
      method: 'POST',
      body: { action: 'markAllAsRead' },
    });

    if (response.ok) {
      setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
      setUnreadCount(0);
    }
  };

  const openNotification = async (notification: InAppNotification) => {
    if (!notification.isRead) {
      await markAsRead(notification.id);
    }

    setIsOpen(false);
    router.push(getNotificationPath(notification));
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        aria-label={`通知${unreadCount > 0 ? `，${unreadCount} 則未讀` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-4 text-white">
            {formatUnreadCount(unreadCount)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-x-3 top-20 z-[9990] max-h-[calc(100vh-6rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl sm:absolute sm:inset-auto sm:right-0 sm:top-12 sm:w-96">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">通知中心</h2>
              <p className="text-xs text-gray-500">{unreadCount > 0 ? `${unreadCount} 則未讀` : '沒有未讀通知'}</p>
            </div>
            <button
              type="button"
              onClick={() => void markAllAsRead()}
              disabled={unreadCount === 0}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:text-gray-400 disabled:hover:bg-transparent"
            >
              <CheckCheck className="h-4 w-4" />
              全部已讀
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                載入通知中
              </div>
            ) : notifications.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void openNotification(notification)}
                    className={`block w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                      notification.isRead ? 'bg-white' : 'bg-blue-50/70'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.isRead ? 'bg-gray-300' : 'bg-blue-600'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-gray-900">{notification.title}</span>
                        <span className="mt-1 line-clamp-2 block text-sm leading-5 text-gray-600">{notification.message}</span>
                        <span className="mt-1 block text-xs text-gray-400">{formatRelativeTime(notification.createdAt)}</span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                目前沒有通知
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 px-4 py-3">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="block min-h-10 rounded-md px-3 py-2 text-center text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50"
            >
              查看全部通知
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
