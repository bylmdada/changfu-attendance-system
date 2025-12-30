import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';

/**
 * 獲取登入日誌 API
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const username = searchParams.get('username');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // 建立查詢條件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (username) {
      where.username = { contains: username };
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // 查詢總數
    const total = await prisma.loginLog.count({ where });

    // 查詢資料
    const logs = await prisma.loginLog.findMany({
      where,
      include: {
        user: {
          include: {
            employee: {
              select: {
                name: true,
                department: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // 統計數據
    const stats = await prisma.loginLog.groupBy({
      by: ['status'],
      _count: { status: true },
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 最近7天
        }
      }
    });

    return NextResponse.json({
      success: true,
      logs: logs.map(log => ({
        id: log.id,
        username: log.username,
        employeeName: log.user?.employee?.name || null,
        department: log.user?.employee?.department || null,
        ipAddress: log.ipAddress,
        device: log.device,
        browser: log.browser,
        os: log.os,
        status: log.status,
        failReason: log.failReason,
        createdAt: log.createdAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: stats.reduce((acc, s) => {
        acc[s.status] = s._count.status;
        return acc;
      }, {} as Record<string, number>),
    });
  } catch (error) {
    console.error('獲取登入日誌失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
