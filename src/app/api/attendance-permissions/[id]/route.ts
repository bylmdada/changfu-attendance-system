import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { normalizeAttendancePermissions } from '@/lib/attendance-permission-scopes';

interface DecodedToken {
  role: string;
  employeeId?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadDepartmentNames(): Promise<Set<string>> {
  const departments = await prisma.department.findMany({
    select: { name: true }
  });

  return new Set(departments.map((department) => department.name));
}

function parseAttendancePermissionId(rawId: string): number | null {
  const parsed = parseIntegerQueryParam(rawId, { min: 1 });
  return parsed.isValid ? parsed.value : null;
}

// PATCH - 更新權限設定
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const { id: idParam } = await params;
    const id = parseAttendancePermissionId(idParam);
    if (id === null) {
      return NextResponse.json({ error: '無效的權限ID' }, { status: 400 });
    }

    const decoded = await getUserFromRequest(request) as DecodedToken | null;
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '缺少權限設定' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;
    const permissions = isPlainObject(data) && isPlainObject(data.permissions)
      ? normalizeAttendancePermissions(data.permissions)
      : undefined;

    // 驗證權限數據
    if (!permissions) {
      return NextResponse.json({ error: '缺少權限設定' }, { status: 400 });
    }

    // 驗證至少有一個權限
    const hasPermissions = Object.values(permissions).some(perm => 
      Array.isArray(perm) && perm.length > 0
    );

    if (!hasPermissions) {
      return NextResponse.json({ error: '請至少選擇一個權限' }, { status: 400 });
    }

    const existingPermission = await prisma.attendancePermission.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!existingPermission) {
      return NextResponse.json({ error: '找不到權限設定' }, { status: 404 });
    }

    const departmentNames = await loadDepartmentNames();
    const invalidDepartments = [...new Set(
      Object.values(permissions).flat().filter((department) => !departmentNames.has(department))
    )];

    if (invalidDepartments.length > 0) {
      return NextResponse.json(
        { error: `包含無效的部門：${invalidDepartments.join('、')}` },
        { status: 400 }
      );
    }

    // 更新權限設定
    const updatedPermission = await prisma.attendancePermission.update({
      where: { id },
      data: {
        permissions
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      }
    });

    return NextResponse.json(updatedPermission);
  } catch (error) {
    console.error('更新權限設定失敗:', error);
    return NextResponse.json(
      { error: '更新權限設定失敗' },
      { status: 500 }
    );
  }
}

// DELETE - 刪除權限設定
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const { id: idParam } = await params;
    const id = parseAttendancePermissionId(idParam);
    if (id === null) {
      return NextResponse.json({ error: '無效的權限ID' }, { status: 400 });
    }

    const decoded = await getUserFromRequest(request) as DecodedToken | null;
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const existingPermission = await prisma.attendancePermission.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!existingPermission) {
      return NextResponse.json({ error: '找不到權限設定' }, { status: 404 });
    }

    // 刪除權限設定
    await prisma.attendancePermission.delete({
      where: { id }
    });

    return NextResponse.json({ 
      message: '權限設定已刪除' 
    });
  } catch (error) {
    console.error('刪除權限設定失敗:', error);
    return NextResponse.json(
      { error: '刪除權限設定失敗' },
      { status: 500 }
    );
  }
}
