/**
 * 部門主管管理 API
 * GET: 取得所有部門主管
 * POST: 新增部門主管
 * PUT: 更新部門主管
 * DELETE: 刪除部門主管
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

const BOOLEAN_FIELDS = [
  'isPrimary',
  'canApproveLeave',
  'canApproveOvertime',
  'canApproveShift',
  'canApprovePurchase',
  'canSchedule',
  'isActive',
] as const;

function parsePositiveInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// GET: 取得所有部門主管
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    // 取得所有部門主管
    const managers = await prisma.departmentManager.findMany({
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        deputies: {
          include: {
            deputyEmployee: {
              select: {
                id: true,
                employeeId: true,
                name: true,
                department: true
              }
            }
          }
        }
      },
      orderBy: [
        { department: 'asc' },
        { isPrimary: 'desc' }
      ]
    });

    // 取得所有部門列表
    const departments = await prisma.employee.findMany({
      where: { isActive: true },
      select: { department: true },
      distinct: ['department']
    });

    // 取得所有員工（用於選擇）
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        position: true
      },
      orderBy: { name: 'asc' }
    });

    return NextResponse.json({
      success: true,
      managers: managers.map(m => ({
        id: m.id,
        employeeId: m.employeeId,
        employeeName: m.employee.name,
        employeeCode: m.employee.employeeId,
        department: m.department,
        isPrimary: m.isPrimary,
        canApproveLeave: m.canApproveLeave,
        canApproveOvertime: m.canApproveOvertime,
        canApproveShift: m.canApproveShift,
        canApprovePurchase: m.canApprovePurchase,
        canSchedule: m.canSchedule,
        isActive: m.isActive,
        deputies: m.deputies.map(d => ({
          id: d.id,
          employeeId: d.deputyEmployeeId,
          employeeName: d.deputyEmployee.name,
          startDate: d.startDate?.toISOString().split('T')[0],
          endDate: d.endDate?.toISOString().split('T')[0],
          isActive: d.isActive
        }))
      })),
      departments: departments.map(d => d.department).filter(Boolean),
      employees
    });

  } catch (error) {
    console.error('取得部門主管失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST: 新增部門主管
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
    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }
    const { employeeId, department, isPrimary = true } = data;

    if (!employeeId || !department) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const normalizedEmployeeId = parsePositiveInteger(employeeId);
    if (!normalizedEmployeeId) {
      return NextResponse.json({ error: '員工 ID 必須為正整數' }, { status: 400 });
    }

    if (typeof department !== 'string' || department.trim().length === 0) {
      return NextResponse.json({ error: '部門名稱格式無效' }, { status: 400 });
    }

    if (isPrimary !== undefined && typeof isPrimary !== 'boolean') {
      return NextResponse.json({ error: '主管權限欄位必須為布林值' }, { status: 400 });
    }

    // 檢查是否已存在
    const existing = await prisma.departmentManager.findUnique({
      where: {
        employeeId_department: {
          employeeId: normalizedEmployeeId,
          department: department.trim()
        }
      }
    });

    if (existing) {
      return NextResponse.json({ error: '該員工已是此部門主管' }, { status: 400 });
    }

    // 如果設為正主管，將現有正主管改為副主管
    if (isPrimary) {
      await prisma.departmentManager.updateMany({
        where: { department: department.trim(), isPrimary: true },
        data: { isPrimary: false }
      });
    }

    const manager = await prisma.departmentManager.create({
      data: {
        employeeId: normalizedEmployeeId,
        department: department.trim(),
        isPrimary
      },
      include: {
        employee: {
          select: { name: true }
        }
      }
    });

    return NextResponse.json({
      success: true,
      manager: {
        id: manager.id,
        employeeId: manager.employeeId,
        employeeName: manager.employee.name,
        department: manager.department,
        isPrimary: manager.isPrimary
      }
    });

  } catch (error) {
    console.error('新增部門主管失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT: 更新部門主管
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
    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }
    const { id, isPrimary, canApproveLeave, canApproveOvertime, canApproveShift, canApprovePurchase, canSchedule, isActive } = data;

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    const normalizedId = parsePositiveInteger(id);
    if (!normalizedId) {
      return NextResponse.json({ error: '主管設定 ID 必須為正整數' }, { status: 400 });
    }

    for (const field of BOOLEAN_FIELDS) {
      if (field in data && typeof data[field] !== 'boolean') {
        return NextResponse.json({ error: '主管權限欄位必須為布林值' }, { status: 400 });
      }
    }

    const existing = await prisma.departmentManager.findUnique({
      where: { id: normalizedId }
    });

    if (!existing) {
      return NextResponse.json({ error: '找不到主管記錄' }, { status: 404 });
    }

    // 如果設為正主管，更新其他主管
    if (isPrimary && !existing.isPrimary) {
      await prisma.departmentManager.updateMany({
        where: { department: existing.department, isPrimary: true },
        data: { isPrimary: false }
      });
    }

    const manager = await prisma.departmentManager.update({
      where: { id: normalizedId },
      data: {
        isPrimary: isPrimary ?? existing.isPrimary,
        canApproveLeave: canApproveLeave ?? existing.canApproveLeave,
        canApproveOvertime: canApproveOvertime ?? existing.canApproveOvertime,
        canApproveShift: canApproveShift ?? existing.canApproveShift,
        canApprovePurchase: canApprovePurchase ?? existing.canApprovePurchase,
        canSchedule: canSchedule ?? existing.canSchedule,
        isActive: isActive ?? existing.isActive
      }
    });

    return NextResponse.json({
      success: true,
      manager
    });

  } catch (error) {
    console.error('更新部門主管失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE: 刪除部門主管
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

    await prisma.departmentManager.delete({
      where: { id }
    });

    return NextResponse.json({
      success: true,
      message: '已刪除'
    });

  } catch (error) {
    console.error('刪除部門主管失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
