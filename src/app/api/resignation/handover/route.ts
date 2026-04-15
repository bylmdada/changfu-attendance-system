/**
 * 交接項目 API
 * PUT: 更新交接項目狀態（完成/未完成）
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function parsePositiveIntegerInput(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export async function PUT(request: NextRequest) {
  try {
    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員/HR 可以更新交接項目
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限操作' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success || !parsedBody.data) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const itemId = parsePositiveIntegerInput(parsedBody.data.itemId);
    const completed = parsedBody.data.completed;
    const notes = normalizeOptionalString(parsedBody.data.notes);
    const assignedTo = normalizeOptionalString(parsedBody.data.assignedTo);

    if (!itemId) {
      return NextResponse.json({ error: '項目ID格式無效' }, { status: 400 });
    }

    if (completed !== undefined && typeof completed !== 'boolean') {
      return NextResponse.json({ error: 'completed 格式無效' }, { status: 400 });
    }

    const item = await prisma.handoverItem.findUnique({
      where: { id: itemId }
    });

    if (!item) {
      return NextResponse.json({ error: '找不到交接項目' }, { status: 404 });
    }

    const updated = await prisma.handoverItem.update({
      where: { id: itemId },
      data: {
        completed: completed ?? item.completed,
        completedAt: completed ? new Date() : null,
        completedBy: completed ? user.username : null,
        notes: notes ?? item.notes,
        assignedTo: assignedTo ?? item.assignedTo
      }
    });

    return NextResponse.json({
      success: true,
      item: updated,
      message: completed ? '已標記為完成' : '已更新'
    });

  } catch (error) {
    console.error('更新交接項目失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員/HR 可以新增交接項目
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限操作' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success || !parsedBody.data) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const resignationId = parsePositiveIntegerInput(parsedBody.data.resignationId);
    const category = normalizeOptionalString(parsedBody.data.category);
    const description = normalizeOptionalString(parsedBody.data.description);
    const assignedTo = normalizeOptionalString(parsedBody.data.assignedTo);

    if (!resignationId) {
      return NextResponse.json({ error: '離職申請ID格式無效' }, { status: 400 });
    }

    if (!category || !description) {
      return NextResponse.json({ error: '請填寫必要欄位' }, { status: 400 });
    }

    const item = await prisma.handoverItem.create({
      data: {
        resignationId,
        category,
        description,
        assignedTo
      }
    });

    return NextResponse.json({
      success: true,
      item,
      message: '交接項目已新增'
    });

  } catch (error) {
    console.error('新增交接項目失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員/HR 可以刪除交接項目
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const parsedItemId = parseIntegerQueryParam(searchParams.get('id'), { min: 1 });

    if (!parsedItemId.isValid || parsedItemId.value === null) {
      return NextResponse.json({ error: '項目ID格式無效' }, { status: 400 });
    }

    await prisma.handoverItem.delete({
      where: { id: parsedItemId.value }
    });

    return NextResponse.json({
      success: true,
      message: '交接項目已刪除'
    });

  } catch (error) {
    console.error('刪除交接項目失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
