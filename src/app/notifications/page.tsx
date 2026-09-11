'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Loader2, Trash2 } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import EmptyState from '@/components/EmptyState';
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

const PAGE_SIZE = 20;

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<number | 'all' | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      if (unreadOnly) {
        params.set('unreadOnly', 'true');
      }

      const response = await fetch(`/api/in-app-notifications?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) return;

      const data = await response.json() as NotificationResponse;
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
    } catch (error) {
      console.error('讀取通知列表失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [offset, unreadOnly]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const markAsRead = async (notificationId: number) => {
    setActingId(notificationId);
    try {
      const response = await fetchJSONWithCSRF('/api/in-app-notifications', {
        method: 'POST',
        body: {
          action: 'markAsRead',
          notificationIds: [notificationId],
        },
      });

      if (response.ok) {
        await loadNotifications();
      }
    } finally {
      setActingId(null);
    }
  };

  const deleteNotification = async (notificationId: number) => {
    setActingId(notificationId);
    try {
      const response = await fetchJSONWithCSRF('/api/in-app-notifications', {
        method: 'POST',
        body: {
          action: 'delete',
          notificationIds: [notificationId],
        },
      });

      if (response.ok) {
        await loadNotifications();
      }
    } finally {
      setActingId(null);
    }
  };

  const markAllAsRead = async () => {
    setActingId('all');
    try {
      const response = await fetchJSONWithCSRF('/api/in-app-notifications', {
        method: 'POST',
        body: { action: 'markAllAsRead' },
      });

      if (response.ok) {
        await loadNotifications();
      }
    } finally {
      setActingId(null);
    }
  };

  const canGoPrev = offset > 0;
  const canGoNext = offset + PAGE_SIZE < total;

  return (
    <AuthenticatedLayout>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
              <Bell className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">通知中心</h1>
              <p className="text-sm text-gray-600">未讀 {unreadCount} 則，依時間由新到舊排列</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void markAllAsRead()}
            disabled={unreadCount === 0 || actingId === 'all'}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {actingId === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
            全部標為已讀
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => {
                setUnreadOnly(false);
                setOffset(0);
              }}
              className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                !unreadOnly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              全部
            </button>
            <button
              type="button"
              onClick={() => {
                setUnreadOnly(true);
                setOffset(0);
              }}
              className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                unreadOnly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              未讀
            </button>
          </div>

          <p className="text-sm text-gray-500">
            共 {total} 則通知
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-16 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              載入通知中
            </div>
          ) : notifications.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {notifications.map((notification) => (
                <div key={notification.id} className={`px-4 py-4 ${notification.isRead ? 'bg-white' : 'bg-blue-50/60'}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {!notification.isRead && <span className="h-2 w-2 rounded-full bg-blue-600" />}
                        <h2 className="truncate text-base font-semibold text-gray-900">{notification.title}</h2>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">{notification.message}</p>
                      <p className="mt-2 text-xs text-gray-500">
                        {formatDateTime(notification.createdAt)} · {notification.type}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      {!notification.isRead && (
                        <button
                          type="button"
                          onClick={() => void markAsRead(notification.id)}
                          disabled={actingId === notification.id}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-50"
                        >
                          {actingId === notification.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                          已讀
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void deleteNotification(notification.id)}
                        disabled={actingId === notification.id}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        刪除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-12">
              <EmptyState
                icon={<Bell className="h-8 w-8" />}
                title={unreadOnly ? '沒有未讀通知' : '目前沒有通知'}
                description="系統通知、審核結果與提醒會顯示在這裡。"
              />
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm sm:flex-row">
          <p className="text-sm text-gray-500">
            第 {Math.floor(offset / PAGE_SIZE) + 1} 頁
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              disabled={!canGoPrev}
              className="min-h-10 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一頁
            </button>
            <button
              type="button"
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              disabled={!canGoNext}
              className="min-h-10 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一頁
            </button>
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
