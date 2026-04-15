import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { parseIntegerQueryParam } from '@/lib/query-params';

function parseDateFilter(rawValue: string | null) {
  if (!rawValue) {
    return { value: null, isValid: true };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return { value: null, isValid: false };
  }

  const value = new Date(`${rawValue}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) {
    return { value: null, isValid: false };
  }

  return { value, isValid: true };
}

/**
 * 獲取登入日誌 API
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const pageResult = parseIntegerQueryParam(searchParams.get('page'), { defaultValue: 1, min: 1 });
    if (!pageResult.isValid || pageResult.value === null) {
      return NextResponse.json({ error: 'page 參數格式無效' }, { status: 400 });
    }

    const limitResult = parseIntegerQueryParam(searchParams.get('limit'), { defaultValue: 50, min: 1, max: 200 });
    if (!limitResult.isValid || limitResult.value === null) {
      return NextResponse.json({ error: 'limit 參數格式無效' }, { status: 400 });
    }

    const page = pageResult.value;
    const limit = limitResult.value;
    const username = searchParams.get('username');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const startDateResult = parseDateFilter(startDate);
    const endDateResult = parseDateFilter(endDate);
    if (!startDateResult.isValid || !endDateResult.isValid) {
      return NextResponse.json({ error: '日期格式無效' }, { status: 400 });
    }

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
      if (startDateResult.value) {
        where.createdAt.gte = startDateResult.value;
      }
      if (endDateResult.value) {
        const end = new Date(endDateResult.value);
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
