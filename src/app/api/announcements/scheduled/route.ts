import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { sendNotification } from '@/lib/realtime-notifications';

// POST: 執行定時發布檢查（可由 cron job 或手動觸發）
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const now = new Date();
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = prisma as any;
    
    // 先取得要發布的公告資訊（用於發送通知）
    const announcementsToPublish = await db.announcement.findMany({
      where: {
        scheduledPublishAt: { not: null, lte: now },
        isPublished: false
      },
      select: {
        id: true,
        title: true,
        category: true,
        priority: true
      }
    });
    
    // 使用 Prisma 原生查詢來更新
    const result = await prisma.$executeRaw`
      UPDATE announcements 
      SET is_published = true, 
          published_at = ${now},
          scheduled_publish_at = NULL
      WHERE scheduled_publish_at IS NOT NULL 
        AND scheduled_publish_at <= ${now}
        AND is_published = false
    `;

    // 對緊急通知和高優先級公告發送即時通知
    for (const announcement of announcementsToPublish) {
      if (announcement.category === 'URGENT' || announcement.priority === 'HIGH') {
        try {
          await sendNotification({
            type: 'ANNOUNCEMENT',
            priority: announcement.category === 'URGENT' ? 'URGENT' : 'HIGH',
            channels: ['WEB', 'IN_APP'],
            title: announcement.category === 'URGENT' ? '🚨 緊急通知' : '📢 重要公告',
            message: announcement.title,
            data: { 
              announcementId: announcement.id,
              category: announcement.category,
              priority: announcement.priority,
              scheduledPublish: true
            },
            createdBy: 'system'
          });
          console.log(`📢 已發送定時公告通知: ${announcement.title}`);
        } catch (notifError) {
          console.error('發送定時公告通知失敗:', notifError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `已發布 ${result} 筆定時公告`,
      publishedCount: result
    });
  } catch (error) {
    console.error('執行定時發布失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// GET: 取得待發布的定時公告
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = prisma as any;
    
    const scheduledAnnouncements = await db.announcement.findMany({
      where: {
        scheduledPublishAt: { not: null },
        isPublished: false
      },
      orderBy: { scheduledPublishAt: 'asc' },
      include: {
        publisher: {
          select: { id: true, name: true, department: true }
        }
      }
    });

    return NextResponse.json({
      success: true,
      announcements: scheduledAnnouncements,
      total: scheduledAnnouncements.length
    });
  } catch (error) {
    console.error('取得定時公告失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
