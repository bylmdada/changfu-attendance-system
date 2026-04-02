import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

// GET - 查詢審計日誌
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const action = searchParams.get('action');
    const targetType = searchParams.get('targetType');
    const employeeId = searchParams.get('employeeId');
    const riskLevel = searchParams.get('riskLevel');
    const flaggedOnly = searchParams.get('flaggedOnly') === 'true';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');

    // 建立查詢條件
    const whereClause: {
      createdAt?: { gte?: Date; lte?: Date };
      action?: string;
      targetType?: string;
      employeeId?: number;
      riskLevel?: string;
      isFlagged?: boolean;
    } = {};

    if (startDate) {
      whereClause.createdAt = { ...whereClause.createdAt, gte: new Date(startDate) };
    }
    if (endDate) {
      whereClause.createdAt = { ...whereClause.createdAt, lte: new Date(endDate) };
    }
    if (action) {
      whereClause.action = action;
    }
    if (targetType) {
      whereClause.targetType = targetType;
    }
    if (employeeId) {
      whereClause.employeeId = parseInt(employeeId);
    }
    if (riskLevel) {
      whereClause.riskLevel = riskLevel;
    }
    if (flaggedOnly) {
      whereClause.isFlagged = true;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: whereClause,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              department: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.auditLog.count({ where: whereClause })
    ]);

    // 統計各風險等級數量
    const riskStats = await prisma.auditLog.groupBy({
      by: ['riskLevel'],
      where: whereClause,
      _count: { id: true }
    });

    return NextResponse.json({
      success: true,
      logs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      },
      stats: {
        riskLevels: riskStats.reduce((acc, r) => {
          acc[r.riskLevel] = r._count.id;
          return acc;
        }, {} as Record<string, number>)
      }
    });
  } catch (error) {
    console.error('查詢審計日誌失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
