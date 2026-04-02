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

    const data = await request.json();
    const { employeeId, department, isPrimary = true } = data;

    if (!employeeId || !department) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    // 檢查是否已存在
    const existing = await prisma.departmentManager.findUnique({
      where: {
        employeeId_department: {
          employeeId,
          department
        }
      }
    });

    if (existing) {
      return NextResponse.json({ error: '該員工已是此部門主管' }, { status: 400 });
    }

    // 如果設為正主管，將現有正主管改為副主管
    if (isPrimary) {
      await prisma.departmentManager.updateMany({
        where: { department, isPrimary: true },
        data: { isPrimary: false }
      });
    }

    const manager = await prisma.departmentManager.create({
      data: {
        employeeId,
        department,
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

    const data = await request.json();
    const { id, isPrimary, canApproveLeave, canApproveOvertime, canApproveShift, canApprovePurchase, canSchedule, isActive } = data;

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    const existing = await prisma.departmentManager.findUnique({
      where: { id }
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
      where: { id },
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
    const id = parseInt(searchParams.get('id') || '');

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
