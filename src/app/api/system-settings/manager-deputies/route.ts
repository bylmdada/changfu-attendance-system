/**
 * 代理人設定 API
 * GET: 取得代理人列表
 * POST: 新增代理人
 * PUT: 更新代理人
 * DELETE: 刪除代理人
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function parsePositiveInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function parseOptionalDate(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function hasOwnProperty(value: unknown, key: string) {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key);
}

// GET: 取得代理人列表
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const deputies = await prisma.managerDeputy.findMany({
      include: {
        manager: {
          include: {
            employee: {
              select: { name: true, department: true }
            }
          }
        },
        deputyEmployee: {
          select: { id: true, name: true, department: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({
      success: true,
      deputies: deputies.map(d => ({
        id: d.id,
        managerId: d.managerId,
        managerName: d.manager.employee.name,
        managerDepartment: d.manager.department,
        deputyEmployeeId: d.deputyEmployeeId,
        deputyName: d.deputyEmployee.name,
        deputyDepartment: d.deputyEmployee.department,
        startDate: d.startDate?.toISOString().split('T')[0],
        endDate: d.endDate?.toISOString().split('T')[0],
        isActive: d.isActive
      }))
    });

  } catch (error) {
    console.error('取得代理人列表失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST: 新增代理人
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

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '僅管理員可新增' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const data = parseResult.data;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { managerId, deputyEmployeeId, startDate, endDate } = data;

    if (!managerId || !deputyEmployeeId) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const normalizedManagerId = parsePositiveInteger(managerId);
    const normalizedDeputyEmployeeId = parsePositiveInteger(deputyEmployeeId);

    if (!normalizedManagerId || !normalizedDeputyEmployeeId) {
      return NextResponse.json({ error: '主管與代理員工 ID 必須為正整數' }, { status: 400 });
    }

    const normalizedStartDate = parseOptionalDate(startDate);
    const normalizedEndDate = parseOptionalDate(endDate);

    if (normalizedStartDate === null || normalizedEndDate === null) {
      return NextResponse.json({ error: '代理日期格式無效' }, { status: 400 });
    }

    const deputy = await prisma.managerDeputy.create({
      data: {
        managerId: normalizedManagerId,
        deputyEmployeeId: normalizedDeputyEmployeeId,
        startDate: normalizedStartDate ?? null,
        endDate: normalizedEndDate ?? null
      }
    });

    return NextResponse.json({
      success: true,
      deputy
    });

  } catch (error) {
    console.error('新增代理人失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT: 更新代理人
export async function PUT(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '僅管理員可修改' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const data = parseResult.data;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { id, deputyEmployeeId, startDate, endDate, isActive } = data;

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    const normalizedId = parsePositiveInteger(id);
    if (!normalizedId) {
      return NextResponse.json({ error: '代理設定 ID 必須為正整數' }, { status: 400 });
    }

    const normalizedDeputyEmployeeId = deputyEmployeeId === undefined
      ? undefined
      : parsePositiveInteger(deputyEmployeeId);

    if (deputyEmployeeId !== undefined && normalizedDeputyEmployeeId === null) {
      return NextResponse.json({ error: '代理員工 ID 必須為正整數' }, { status: 400 });
    }

    const shouldUpdateStartDate = hasOwnProperty(data, 'startDate');
    const shouldUpdateEndDate = hasOwnProperty(data, 'endDate');
    const shouldUpdateIsActive = hasOwnProperty(data, 'isActive');
    const normalizedIsActive = shouldUpdateIsActive && typeof isActive === 'boolean'
      ? isActive
      : undefined;

    const normalizedStartDate = shouldUpdateStartDate ? parseOptionalDate(startDate) : undefined;
    const normalizedEndDate = shouldUpdateEndDate ? parseOptionalDate(endDate) : undefined;

    if (normalizedStartDate === null || normalizedEndDate === null) {
      return NextResponse.json({ error: '代理日期格式無效' }, { status: 400 });
    }

    if (shouldUpdateIsActive && normalizedIsActive === undefined) {
      return NextResponse.json({ error: '啟用狀態必須為布林值' }, { status: 400 });
    }

    const updateData: Prisma.ManagerDeputyUncheckedUpdateInput = {};

    if (normalizedDeputyEmployeeId !== undefined && normalizedDeputyEmployeeId !== null) {
      updateData.deputyEmployeeId = normalizedDeputyEmployeeId;
    }

    if (shouldUpdateStartDate) {
      updateData.startDate = normalizedStartDate ?? null;
    }

    if (shouldUpdateEndDate) {
      updateData.endDate = normalizedEndDate ?? null;
    }

    if (shouldUpdateIsActive) {
      updateData.isActive = normalizedIsActive;
    }

    const deputy = await prisma.managerDeputy.update({
      where: { id: normalizedId },
      data: updateData
    });

    return NextResponse.json({
      success: true,
      deputy
    });

  } catch (error) {
    console.error('更新代理人失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE: 刪除代理人
export async function DELETE(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '僅管理員可刪除' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id');
    const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    await prisma.managerDeputy.delete({
      where: { id }
    });

    return NextResponse.json({
      success: true,
      message: '已刪除'
    });

  } catch (error) {
    console.error('刪除代理人失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
