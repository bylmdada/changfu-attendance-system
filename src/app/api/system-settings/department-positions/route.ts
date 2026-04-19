import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { safeParseJSON } from '@/lib/validation';
import { DEPARTMENT_OPTIONS, DEPARTMENT_POSITIONS } from '@/constants/departments';

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}

function parseOptionalName(value: unknown) {
  if (value === undefined) {
    return { success: true as const };
  }

  if (typeof value !== 'string') {
    return { success: false as const };
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return { success: false as const };
  }

  return { success: true as const, value: trimmedValue };
}

function parseOptionalSortOrder(value: unknown) {
  if (value === undefined) {
    return { success: true as const };
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { success: false as const };
  }

  return { success: true as const, value };
}

function parseOptionalBoolean(value: unknown) {
  if (value === undefined) {
    return { success: true as const };
  }

  if (typeof value !== 'boolean') {
    return { success: false as const };
  }

  return { success: true as const, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueConstraintError(error: unknown) {
  if (!isPlainObject(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';

  return code === 'P2002' || message.includes('UNIQUE constraint failed');
}

// 獲取所有部門與職位
export async function GET(request: NextRequest) {
  try {
    const userAuth = await getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get('departmentId');
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const parsedDepartmentId = departmentId ? parsePositiveInteger(departmentId) : null;
    if (departmentId && parsedDepartmentId === null) {
      return NextResponse.json({ error: '部門 ID 格式無效' }, { status: 400 });
    }
    
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
    if (parsedDepartmentId !== null) {
      const department = dbDepartments.find(d => d.id === parsedDepartmentId);
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
    const userAuth = await getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const bodyResult = await safeParseJSON(request);

    if (!bodyResult.success) {
      return NextResponse.json(
        {
          error: bodyResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式'
        },
        { status: 400 }
      );
    }

    const body = bodyResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { action, departmentId, name } = body;

    const parsedDepartmentId = departmentId !== undefined ? parsePositiveInteger(departmentId) : null;
    const parsedName = parseOptionalName(name);

    if (action === 'addDepartment') {
      // 新增部門
      if (!parsedName.success || parsedName.value === undefined) {
        return NextResponse.json({ error: '部門名稱不能為空' }, { status: 400 });
      }

      const existingDept = await prisma.department.findUnique({ where: { name: parsedName.value } });
      if (existingDept) {
        return NextResponse.json({ error: '部門名稱已存在' }, { status: 400 });
      }

      const maxOrder = await prisma.department.aggregate({ _max: { sortOrder: true } });
      const newDepartment = await prisma.department.create({
        data: {
          name: parsedName.value,
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
      if (!departmentId || !parsedName.success || parsedName.value === undefined) {
        return NextResponse.json({ error: '部門 ID 和職位名稱不能為空' }, { status: 400 });
      }

      if (parsedDepartmentId === null) {
        return NextResponse.json({ error: '部門 ID 格式無效' }, { status: 400 });
      }

      const department = await prisma.department.findUnique({ where: { id: parsedDepartmentId } });
      if (!department) {
        return NextResponse.json({ error: '部門不存在' }, { status: 404 });
      }

      const existingPos = await prisma.position.findFirst({
        where: { departmentId: parsedDepartmentId, name: parsedName.value }
      });
      if (existingPos) {
        return NextResponse.json({ error: '該部門已有相同職位' }, { status: 400 });
      }

      const maxOrder = await prisma.position.aggregate({
        where: { departmentId: parsedDepartmentId },
        _max: { sortOrder: true }
      });

      const newPosition = await prisma.position.create({
        data: {
          departmentId: parsedDepartmentId,
          name: parsedName.value,
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
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: '部門名稱或職位名稱已存在' }, { status: 400 });
    }

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
    const userAuth = await getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const bodyResult = await safeParseJSON(request);

    if (!bodyResult.success) {
      return NextResponse.json(
        {
          error: bodyResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式'
        },
        { status: 400 }
      );
    }

    const body = bodyResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { action, id, name, sortOrder, isActive, positions } = body;

    const parsedId = id !== undefined ? parsePositiveInteger(id) : null;

    if (action === 'updateDepartment') {
      if (parsedId === null) {
        return NextResponse.json({ error: 'ID 格式無效' }, { status: 400 });
      }

      const parsedName = parseOptionalName(name);
      const parsedSortOrder = parseOptionalSortOrder(sortOrder);
      const parsedIsActive = parseOptionalBoolean(isActive);

      if (!parsedName.success) {
        return NextResponse.json({ error: '部門名稱格式無效' }, { status: 400 });
      }

      if (!parsedSortOrder.success) {
        return NextResponse.json({ error: '排序值格式無效' }, { status: 400 });
      }

      if (!parsedIsActive.success) {
        return NextResponse.json({ error: '啟用狀態格式無效' }, { status: 400 });
      }

      const existingDepartment = await prisma.department.findUnique({
        where: { id: parsedId },
      });

      if (!existingDepartment) {
        return NextResponse.json({ error: '部門不存在' }, { status: 404 });
      }

      if (parsedName.value !== undefined && parsedName.value !== existingDepartment.name) {
        const duplicateDepartment = await prisma.department.findUnique({
          where: { name: parsedName.value }
        });

        if (duplicateDepartment && duplicateDepartment.id !== parsedId) {
          return NextResponse.json({ error: '部門名稱已存在' }, { status: 400 });
        }
      }

      const updateData: Record<string, unknown> = {};
      if (parsedName.value !== undefined) updateData.name = parsedName.value;
      if (parsedSortOrder.value !== undefined) updateData.sortOrder = parsedSortOrder.value;
      if (parsedIsActive.value !== undefined) updateData.isActive = parsedIsActive.value;

      const updated = await prisma.$transaction(async (tx) => {
        const updatedDepartment = await tx.department.update({
          where: { id: parsedId },
          data: updateData,
          include: { positions: { orderBy: { sortOrder: 'asc' } } }
        });

        if (parsedName.value !== undefined && parsedName.value !== existingDepartment.name) {
          await tx.employee.updateMany({
            where: { department: existingDepartment.name },
            data: { department: parsedName.value }
          });
        }

        return updatedDepartment;
      });

      return NextResponse.json({ success: true, department: updated });
    }

    if (action === 'updatePosition') {
      if (parsedId === null) {
        return NextResponse.json({ error: 'ID 格式無效' }, { status: 400 });
      }

      const parsedName = parseOptionalName(name);
      const parsedSortOrder = parseOptionalSortOrder(sortOrder);
      const parsedIsActive = parseOptionalBoolean(isActive);

      if (!parsedName.success) {
        return NextResponse.json({ error: '職位名稱格式無效' }, { status: 400 });
      }

      if (!parsedSortOrder.success) {
        return NextResponse.json({ error: '排序值格式無效' }, { status: 400 });
      }

      if (!parsedIsActive.success) {
        return NextResponse.json({ error: '啟用狀態格式無效' }, { status: 400 });
      }

      const existingPosition = await prisma.position.findUnique({
        where: { id: parsedId },
        include: {
          department: {
            select: { name: true }
          }
        }
      });

      if (!existingPosition) {
        return NextResponse.json({ error: '職位不存在' }, { status: 404 });
      }

      if (parsedName.value !== undefined && parsedName.value !== existingPosition.name) {
        const duplicatePosition = await prisma.position.findFirst({
          where: {
            departmentId: existingPosition.departmentId,
            name: parsedName.value,
            NOT: { id: parsedId }
          }
        });

        if (duplicatePosition) {
          return NextResponse.json({ error: '該部門已有相同職位' }, { status: 400 });
        }
      }

      const updateData: Record<string, unknown> = {};
      if (parsedName.value !== undefined) updateData.name = parsedName.value;
      if (parsedSortOrder.value !== undefined) updateData.sortOrder = parsedSortOrder.value;
      if (parsedIsActive.value !== undefined) updateData.isActive = parsedIsActive.value;

      const updated = await prisma.$transaction(async (tx) => {
        const updatedPosition = await tx.position.update({
          where: { id: parsedId },
          data: updateData
        });

        if (parsedName.value !== undefined && parsedName.value !== existingPosition.name) {
          await tx.employee.updateMany({
            where: {
              department: existingPosition.department.name,
              position: existingPosition.name,
            },
            data: { position: parsedName.value }
          });
        }

        return updatedPosition;
      });

      return NextResponse.json({ success: true, position: updated });
    }

    if (action === 'reorderPositions') {
      // 批量更新職位排序
      if (!positions || !Array.isArray(positions)) {
        return NextResponse.json({ error: '無效的職位排序資料' }, { status: 400 });
      }

      const normalizedPositions = positions.map((pos) => {
        if (!isPlainObject(pos)) {
          return null;
        }

        return {
          id: parsePositiveInteger(pos.id),
          sortOrder: typeof pos.sortOrder === 'number' && Number.isInteger(pos.sortOrder) ? pos.sortOrder : null,
        };
      });

      if (normalizedPositions.some(pos => pos === null || pos.id === null || pos.sortOrder === null)) {
        return NextResponse.json({ error: '無效的職位排序資料' }, { status: 400 });
      }

      await prisma.$transaction(
        normalizedPositions.map((pos) =>
          prisma.position.update({
            where: { id: pos!.id as number },
            data: { sortOrder: pos!.sortOrder as number }
          })
        )
      );

      return NextResponse.json({ success: true, message: '排序更新成功' });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: '部門名稱或職位名稱已存在' }, { status: 400 });
    }

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
    const userAuth = await getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const bodyResult = await safeParseJSON(request);

    if (!bodyResult.success) {
      return NextResponse.json(
        {
          error: bodyResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式'
        },
        { status: 400 }
      );
    }

    const body = bodyResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { action, id, ids } = body;

    const parsedId = id !== undefined ? parsePositiveInteger(id) : null;

    if (action === 'deleteDepartment') {
      if (parsedId === null) {
        return NextResponse.json({ error: 'ID 格式無效' }, { status: 400 });
      }

      const existingDepartment = await prisma.department.findUnique({
        where: { id: parsedId },
      });

      if (!existingDepartment) {
        return NextResponse.json({ error: '部門不存在' }, { status: 404 });
      }

      const employeeCount = await prisma.employee.count({
        where: { department: existingDepartment.name }
      });

      if (employeeCount > 0) {
        return NextResponse.json({ error: `仍有 ${employeeCount} 位員工使用此部門，無法刪除` }, { status: 400 });
      }

      // 刪除部門（會連帶刪除所有職位）
      await prisma.department.delete({ where: { id: parsedId } });
      return NextResponse.json({ success: true, message: '部門刪除成功' });
    }

    if (action === 'deletePosition') {
      if (parsedId === null) {
        return NextResponse.json({ error: 'ID 格式無效' }, { status: 400 });
      }

      const existingPosition = await prisma.position.findUnique({
        where: { id: parsedId },
        include: {
          department: {
            select: { name: true }
          }
        }
      });

      if (!existingPosition) {
        return NextResponse.json({ error: '職位不存在' }, { status: 404 });
      }

      const employeeCount = await prisma.employee.count({
        where: {
          department: existingPosition.department.name,
          position: existingPosition.name,
        }
      });

      if (employeeCount > 0) {
        return NextResponse.json({ error: `仍有 ${employeeCount} 位員工使用此職位，無法刪除` }, { status: 400 });
      }

      await prisma.position.delete({ where: { id: parsedId } });
      return NextResponse.json({ success: true, message: '職位刪除成功' });
    }

    if (action === 'deletePositions') {
      // 批量刪除職位
      if (!ids || !Array.isArray(ids)) {
        return NextResponse.json({ error: '無效的職位 ID 列表' }, { status: 400 });
      }

      const normalizedIds = ids.map((value: unknown) => parsePositiveInteger(value));
      if (normalizedIds.some(value => value === null)) {
        return NextResponse.json({ error: '無效的職位 ID 列表' }, { status: 400 });
      }

      const requestedIds = normalizedIds as number[];
      const existingPositions = await prisma.position.findMany({
        where: { id: { in: requestedIds } },
        include: {
          department: {
            select: { name: true }
          }
        }
      });
      const missingIds = requestedIds.filter(requestedId => !existingPositions.some(position => position.id === requestedId));
      const deletableIds: number[] = [];
      const failedIds = [...missingIds];

      for (const position of existingPositions) {
        const employeeCount = await prisma.employee.count({
          where: {
            department: position.department.name,
            position: position.name,
          }
        });

        if (employeeCount > 0) {
          failedIds.push(position.id);
          continue;
        }

        deletableIds.push(position.id);
      }

      if (deletableIds.length === 0) {
        return NextResponse.json({ error: '選取的職位仍有員工使用或不存在，無法刪除' }, { status: 400 });
      }

      const deleteResult = await prisma.position.deleteMany({ where: { id: { in: deletableIds } } });
      if (deleteResult.count === 0) {
        return NextResponse.json({ error: '找不到可刪除的職位' }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `已刪除 ${deleteResult.count} 個職位`,
        deletedCount: deleteResult.count,
        deletedIds: deletableIds,
        failedIds,
      });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: '部門名稱或職位名稱已存在' }, { status: 400 });
    }

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
