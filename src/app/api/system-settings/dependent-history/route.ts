/**
 * 眷屬異動歷史 API
 * GET: 取得異動歷史記錄
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const dependentId = searchParams.get('dependentId');
    const limit = parseInt(searchParams.get('limit') || '100');

    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (dependentId) where.dependentId = parseInt(dependentId);

    const logs = await prisma.dependentHistoryLog.findMany({
      where,
      orderBy: { changedAt: 'desc' },
      take: limit
    });

    return NextResponse.json({
      success: true,
      logs
    });

  } catch (error) {
    console.error('取得異動歷史失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
