import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { DEPARTMENT_OPTIONS, DEPARTMENT_POSITIONS } from '@/constants/departments';

// 獲取所有部門與職位
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get('departmentId');
    const includeInactive = searchParams.get('includeInactive') === 'true';
    
    // 首先嘗試從資料庫獲取
    const dbDepartments = await prisma.department.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: {
        positions: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: { sortOrder: 'asc' }
        }
      },
      orderBy: { sortOrder: 'asc' }
    });

    // 如果資料庫沒有部門資料，則從常數同步
    if (dbDepartments.length === 0) {
      // 同步靜態常數到資料庫
      await syncStaticDataToDatabase();
      
      // 重新獲取
      const syncedDepartments = await prisma.department.findMany({
        where: includeInactive ? {} : { isActive: true },
        include: {
          positions: {
            where: includeInactive ? {} : { isActive: true },
            orderBy: { sortOrder: 'asc' }
          }
        },
        orderBy: { sortOrder: 'asc' }
      });
      
      return NextResponse.json({
        departments: syncedDepartments.map(dept => ({
          id: dept.id,
          name: dept.name,
          sortOrder: dept.sortOrder,
          isActive: dept.isActive,
          positions: dept.positions.map(pos => ({
            id: pos.id,
            name: pos.name,
            sortOrder: pos.sortOrder,
            isActive: pos.isActive
          }))
        }))
      });
    }

    // 如果有指定部門 ID，只返回該部門
    if (departmentId) {
      const department = dbDepartments.find(d => d.id === parseInt(departmentId));
      if (!department) {
        return NextResponse.json({ error: '部門不存在' }, { status: 404 });
      }
      return NextResponse.json({ department });
    }

    return NextResponse.json({
      departments: dbDepartments.map(dept => ({
        id: dept.id,
        name: dept.name,
        sortOrder: dept.sortOrder,
        isActive: dept.isActive,
        positions: dept.positions.map(pos => ({
          id: pos.id,
          name: pos.name,
          sortOrder: pos.sortOrder,
          isActive: pos.isActive
        }))
      }))
    });
  } catch (error) {
    console.error('Failed to fetch departments:', error);
    return NextResponse.json(
      { error: '獲取部門職位設定失敗' },
      { status: 500 }
    );
  }
}

// 新增部門或職位
export async function POST(request: NextRequest) {
  try {
    // 速率限制
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/department-positions');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 管理員權限
    const userAuth = getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { action, departmentId, name } = body;

    if (action === 'addDepartment') {
      // 新增部門
      if (!name?.trim()) {
        return NextResponse.json({ error: '部門名稱不能為空' }, { status: 400 });
      }

      const existingDept = await prisma.department.findUnique({ where: { name: name.trim() } });
      if (existingDept) {
        return NextResponse.json({ error: '部門名稱已存在' }, { status: 400 });
      }

      const maxOrder = await prisma.department.aggregate({ _max: { sortOrder: true } });
      const newDepartment = await prisma.department.create({
        data: {
          name: name.trim(),
          sortOrder: (maxOrder._max.sortOrder || 0) + 1
        },
        include: { positions: true }
      });

      return NextResponse.json({ 
        success: true, 
        message: '部門新增成功',
        department: newDepartment 
      });
    }

    if (action === 'addPosition') {
      // 新增職位
      if (!departmentId || !name?.trim()) {
        return NextResponse.json({ error: '部門 ID 和職位名稱不能為空' }, { status: 400 });
      }

      const department = await prisma.department.findUnique({ where: { id: departmentId } });
      if (!department) {
        return NextResponse.json({ error: '部門不存在' }, { status: 404 });
      }

      const existingPos = await prisma.position.findFirst({
        where: { departmentId, name: name.trim() }
      });
      if (existingPos) {
        return NextResponse.json({ error: '該部門已有相同職位' }, { status: 400 });
      }

      const maxOrder = await prisma.position.aggregate({
        where: { departmentId },
        _max: { sortOrder: true }
      });

      const newPosition = await prisma.position.create({
        data: {
          departmentId,
          name: name.trim(),
          sortOrder: (maxOrder._max.sortOrder || 0) + 1
        }
      });

      return NextResponse.json({ 
        success: true, 
        message: '職位新增成功',
        position: newPosition 
      });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    console.error('Failed to create department/position:', error);
    return NextResponse.json({ error: '新增失敗' }, { status: 500 });
  }
}

// 更新部門或職位
export async function PUT(request: NextRequest) {
  try {
    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 管理員權限
    const userAuth = getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { action, id, name, sortOrder, isActive, positions } = body;

    if (action === 'updateDepartment') {
      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name.trim();
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
      if (isActive !== undefined) updateData.isActive = isActive;

      const updated = await prisma.department.update({
        where: { id },
        data: updateData,
        include: { positions: { orderBy: { sortOrder: 'asc' } } }
      });

      return NextResponse.json({ success: true, department: updated });
    }

    if (action === 'updatePosition') {
      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name.trim();
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
      if (isActive !== undefined) updateData.isActive = isActive;

      const updated = await prisma.position.update({
        where: { id },
        data: updateData
      });

      return NextResponse.json({ success: true, position: updated });
    }

    if (action === 'reorderPositions') {
      // 批量更新職位排序
      if (!positions || !Array.isArray(positions)) {
        return NextResponse.json({ error: '無效的職位排序資料' }, { status: 400 });
      }

      await prisma.$transaction(
        positions.map((pos: { id: number; sortOrder: number }) =>
          prisma.position.update({
            where: { id: pos.id },
            data: { sortOrder: pos.sortOrder }
          })
        )
      );

      return NextResponse.json({ success: true, message: '排序更新成功' });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    console.error('Failed to update:', error);
    return NextResponse.json({ error: '更新失敗' }, { status: 500 });
  }
}

// 刪除部門或職位
export async function DELETE(request: NextRequest) {
  try {
    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 管理員權限
    const userAuth = getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { action, id, ids } = body;

    if (action === 'deleteDepartment') {
      // 刪除部門（會連帶刪除所有職位）
      await prisma.department.delete({ where: { id } });
      return NextResponse.json({ success: true, message: '部門刪除成功' });
    }

    if (action === 'deletePosition') {
      await prisma.position.delete({ where: { id } });
      return NextResponse.json({ success: true, message: '職位刪除成功' });
    }

    if (action === 'deletePositions') {
      // 批量刪除職位
      if (!ids || !Array.isArray(ids)) {
        return NextResponse.json({ error: '無效的職位 ID 列表' }, { status: 400 });
      }
      
      await prisma.position.deleteMany({ where: { id: { in: ids } } });
      return NextResponse.json({ success: true, message: `已刪除 ${ids.length} 個職位` });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    console.error('Failed to delete:', error);
    return NextResponse.json({ error: '刪除失敗' }, { status: 500 });
  }
}

// 同步靜態常數資料到資料庫
async function syncStaticDataToDatabase() {
  for (let i = 0; i < DEPARTMENT_OPTIONS.length; i++) {
    const deptName = DEPARTMENT_OPTIONS[i];
    const positions = DEPARTMENT_POSITIONS[deptName];

    // 建立部門
    const department = await prisma.department.create({
      data: {
        name: deptName,
        sortOrder: i
      }
    });

    // 建立職位
    if (positions && positions.length > 0) {
      await prisma.position.createMany({
        data: positions.map((posName, index) => ({
          departmentId: department.id,
          name: posName,
          sortOrder: index
        }))
      });
    }
  }
}
