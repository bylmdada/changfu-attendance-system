/**
 * 代理人設定 API
 * GET: 取得代理人列表
 * POST: 新增代理人
 * PUT: 更新代理人
 * DELETE: 刪除代理人
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

// GET: 取得代理人列表
export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
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

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '僅管理員可新增' }, { status: 403 });
    }

    const data = await request.json();
    const { managerId, deputyEmployeeId, startDate, endDate } = data;

    if (!managerId || !deputyEmployeeId) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const deputy = await prisma.managerDeputy.create({
      data: {
        managerId,
        deputyEmployeeId,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null
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

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '僅管理員可修改' }, { status: 403 });
    }

    const data = await request.json();
    const { id, deputyEmployeeId, startDate, endDate, isActive } = data;

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    const deputy = await prisma.managerDeputy.update({
      where: { id },
      data: {
        deputyEmployeeId,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isActive
      }
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

    const user = getUserFromRequest(request);
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
