/**
 * 眷屬異動歷史 API
 * GET: 取得異動歷史記錄
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

const VALID_HISTORY_ACTIONS = new Set(['CREATE', 'UPDATE', 'DELETE']);
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 200;

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

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
    const rawDependentId = searchParams.get('dependentId');
    const rawLimit = searchParams.get('limit');

    if (action && !VALID_HISTORY_ACTIONS.has(action)) {
      return NextResponse.json({ error: '異動類型無效' }, { status: 400 });
    }

    const dependentId = rawDependentId ? parsePositiveInteger(rawDependentId) : null;
    if (rawDependentId && dependentId === null) {
      return NextResponse.json({ error: '眷屬 ID 格式無效' }, { status: 400 });
    }

    const requestedLimit = rawLimit ? parsePositiveInteger(rawLimit) : DEFAULT_HISTORY_LIMIT;
    const limit = Math.min(requestedLimit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);

    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (dependentId) where.dependentId = dependentId;

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
