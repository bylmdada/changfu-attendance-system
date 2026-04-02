/**
 * 推播訂閱管理 API
 * 
 * 處理 Web Push 訂閱的儲存和刪除
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { 
  savePushSubscription, 
  removePushSubscription, 
  getVapidPublicKey,
  sendTestPush
} from '@/lib/push-notifications';
import { systemLogger } from '@/lib/logger';
import { prisma } from '@/lib/database';

// GET - 取得 VAPID 公鑰和訂閱狀態
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 取得用戶的推播訂閱狀態
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { employeeId: true }
    });

    let isSubscribed = false;
    if (user?.employeeId) {
      const settings = await prisma.notificationSettings.findUnique({
        where: { employeeId: user.employeeId },
        select: { pushEnabled: true }
      });
      isSubscribed = settings?.pushEnabled || false;
    }

    return NextResponse.json({
      success: true,
      vapidPublicKey: getVapidPublicKey(),
      isSubscribed
    });
  } catch (error) {
    systemLogger.error('取得推播公鑰失敗', {
      error: error instanceof Error ? error : new Error(String(error))
    });
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 儲存推播訂閱
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const body = await request.json();
    const { subscription, sendTest } = body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return NextResponse.json({ error: '無效的訂閱資料' }, { status: 400 });
    }

    const success = await savePushSubscription(decoded.userId, {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      }
    });

    if (!success) {
      return NextResponse.json({ error: '儲存訂閱失敗' }, { status: 500 });
    }

    // 如果請求發送測試通知
    if (sendTest) {
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { employeeId: true }
      });
      
      if (user?.employeeId) {
        await sendTestPush(user.employeeId);
      }
    }

    return NextResponse.json({
      success: true,
      message: '推播訂閱已儲存'
    });
  } catch (error) {
    systemLogger.error('儲存推播訂閱失敗', {
      error: error instanceof Error ? error : new Error(String(error))
    });
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE - 取消推播訂閱
export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const success = await removePushSubscription(decoded.userId);

    return NextResponse.json({
      success: true,
      message: success ? '推播訂閱已取消' : '未找到訂閱'
    });
  } catch (error) {
    systemLogger.error('取消推播訂閱失敗', {
      error: error instanceof Error ? error : new Error(String(error))
    });
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
