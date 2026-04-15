import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// PATCH - 切換使用者帳號狀態（啟用/停用）
export async function PATCH(request: NextRequest) {
  try {
    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    // 權限檢查
    const currentUser = await getUserFromRequest(request);
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '參數錯誤' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const userId = isPlainObject(body)
      && (typeof body.userId === 'string' || typeof body.userId === 'number')
        ? String(body.userId)
        : undefined;
    const isActive = isPlainObject(body) && typeof body.isActive === 'boolean'
      ? body.isActive
      : undefined;

    if (!userId || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: '參數錯誤' }, { status: 400 });
    }

    // 不允許停用自己
    if (parseInt(userId) === currentUser.userId && !isActive) {
      return NextResponse.json({ error: '無法停用自己的帳號' }, { status: 400 });
    }

    // 更新使用者狀態
    const updatedUser = await prisma.user.update({
      where: { id: parseInt(userId) },
      data: { isActive },
      include: {
        employee: {
          select: {
            name: true,
            employeeId: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: isActive ? '帳號已啟用' : '帳號已停用',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        isActive: updatedUser.isActive,
        employeeName: updatedUser.employee?.name
      }
    });

  } catch (error) {
    console.error('切換帳號狀態失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
