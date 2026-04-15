/**
 * 系統內通知 API
 * GET: 取得用戶的通知列表
 * POST: 標記通知為已讀 / 刪除通知
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (!user.employeeId) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

    const limitResult = parseIntegerQueryParam(searchParams.get('limit'), {
      defaultValue: 50,
      min: 1,
      max: 200,
    });
    if (!limitResult.isValid) {
      return NextResponse.json({ error: 'limit 參數格式無效' }, { status: 400 });
    }

    const offsetResult = parseIntegerQueryParam(searchParams.get('offset'), {
      defaultValue: 0,
      min: 0,
    });
    if (!offsetResult.isValid) {
      return NextResponse.json({ error: 'offset 參數格式無效' }, { status: 400 });
    }

    const limit = limitResult.value ?? 50;
    const offset = offsetResult.value ?? 0;

    const where = {
      employeeId: user.employeeId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.inAppNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.inAppNotification.count({ where }),
      prisma.inAppNotification.count({
        where: { employeeId: user.employeeId, isRead: false },
      }),
    ]);

    return NextResponse.json({
      success: true,
      notifications: notifications.map(notification => ({
        ...notification,
        data: parseNotificationData(notification.data),
      })),
      total,
      unreadCount,
    });
  } catch (error) {
    console.error('取得通知失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (!user.employeeId) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const data = parsedBody.data ?? {};
    const action = typeof data.action === 'string' ? data.action : null;
    const notificationIdsResult = parseNotificationIds(data.notificationIds);

    if (!action) {
      return NextResponse.json({ error: '需要提供操作類型' }, { status: 400 });
    }

    if (action === 'markAsRead') {
      if (!notificationIdsResult.isValid || !notificationIdsResult.value || notificationIdsResult.value.length === 0) {
        return NextResponse.json({ error: 'notificationIds 參數格式無效' }, { status: 400 });
      }

      const result = await prisma.inAppNotification.updateMany({
        where: {
          id: { in: notificationIdsResult.value },
          employeeId: user.employeeId,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      if (result.count === 0) {
        return NextResponse.json({ error: '找不到可標記為已讀的通知' }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `已標記 ${result.count} 則通知為已讀`,
        count: result.count,
      });
    }

    if (action === 'markAllAsRead') {
      const result = await prisma.inAppNotification.updateMany({
        where: {
          employeeId: user.employeeId,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      if (result.count === 0) {
        return NextResponse.json({ error: '沒有可標記為已讀的通知' }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `已標記 ${result.count} 則通知為已讀`,
        count: result.count,
      });
    }

    if (action === 'delete') {
      if (!notificationIdsResult.isValid || !notificationIdsResult.value || notificationIdsResult.value.length === 0) {
        return NextResponse.json({ error: 'notificationIds 參數格式無效' }, { status: 400 });
      }

      const result = await prisma.inAppNotification.deleteMany({
        where: {
          id: { in: notificationIdsResult.value },
          employeeId: user.employeeId,
        },
      });

      if (result.count === 0) {
        return NextResponse.json({ error: '找不到可刪除的通知' }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `已刪除 ${result.count} 則通知`,
        count: result.count,
      });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    console.error('操作通知失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

function parseNotificationData(rawData: string | null) {
  if (!rawData) {
    return null;
  }

  try {
    return JSON.parse(rawData);
  } catch {
    return null;
  }
}

function parseNotificationIds(value: unknown): { isValid: boolean; value?: number[] } {
  if (!Array.isArray(value)) {
    return { isValid: false };
  }

  const normalized = value.map(item => {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) {
      return null;
    }

    return item;
  });

  if (normalized.some(item => item === null)) {
    return { isValid: false };
  }

  return { isValid: true, value: normalized as number[] };
}
