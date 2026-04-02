/**
 * 系統內通知 API
 * GET: 取得用戶的通知列表
 * POST: 標記通知為已讀
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

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
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // 取得通知列表
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
      notifications: notifications.map(n => ({
        ...n,
        data: n.data ? JSON.parse(n.data) : null,
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

    const data = await request.json();
    const { action, notificationIds } = data;

    if (action === 'markAsRead') {
      // 標記特定通知為已讀
      if (notificationIds && notificationIds.length > 0) {
        await prisma.inAppNotification.updateMany({
          where: {
            id: { in: notificationIds },
            employeeId: user.employeeId,
          },
          data: {
            isRead: true,
            readAt: new Date(),
          },
        });
      }

      return NextResponse.json({
        success: true,
        message: '通知已標記為已讀',
      });
    }

    if (action === 'markAllAsRead') {
      // 標記所有通知為已讀
      await prisma.inAppNotification.updateMany({
        where: {
          employeeId: user.employeeId,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        message: '所有通知已標記為已讀',
      });
    }

    if (action === 'delete') {
      // 刪除通知
      if (notificationIds && notificationIds.length > 0) {
        await prisma.inAppNotification.deleteMany({
          where: {
            id: { in: notificationIds },
            employeeId: user.employeeId,
          },
        });
      }

      return NextResponse.json({
        success: true,
        message: '通知已刪除',
      });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    console.error('操作通知失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
