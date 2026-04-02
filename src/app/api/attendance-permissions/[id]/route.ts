import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

interface DecodedToken {
  role: string;
  employeeId?: number;
}

// PATCH - 更新權限設定
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      return NextResponse.json({ error: '無效的權限ID' }, { status: 400 });
    }

    const decoded = await getUserFromRequest(request) as DecodedToken | null;
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const data = await request.json();

    // 驗證權限數據
    if (!data.permissions) {
      return NextResponse.json({ error: '缺少權限設定' }, { status: 400 });
    }

    // 驗證至少有一個權限
    const hasPermissions = Object.values(data.permissions).some(perm => 
      Array.isArray(perm) && perm.length > 0
    );

    if (!hasPermissions) {
      return NextResponse.json({ error: '請至少選擇一個權限' }, { status: 400 });
    }

    // 更新權限設定
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedPermission = await (prisma as any).attendancePermission.update({
      where: { id },
      data: {
        permissions: data.permissions
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
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      return NextResponse.json({ error: '無效的權限ID' }, { status: 400 });
    }

    const decoded = await getUserFromRequest(request) as DecodedToken | null;
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    // 刪除權限設定
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).attendancePermission.delete({
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
