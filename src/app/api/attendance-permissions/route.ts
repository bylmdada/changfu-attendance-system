import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';

interface AttendancePermissionData {
  employeeId: number;
  permissions: {
    leaveRequests: string[];
    overtimeRequests: string[];
    shiftExchanges: string[];
    scheduleManagement: string[];
  };
}

interface DecodedToken {
  role: string;
  employeeId?: number;
}



// GET - 獲取所有權限設定
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const decoded = await getUserFromRequest(request) as DecodedToken | null;
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    // 獲取所有權限設定
    const permissions = await prisma.attendancePermission.findMany({
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
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json(permissions);
  } catch (error) {
    console.error('獲取權限設定失敗:', error);
    return NextResponse.json(
      { error: '獲取權限設定失敗' },
      { status: 500 }
    );
  }
}

// POST - 新增權限設定
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request) as DecodedToken | null;
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const data: AttendancePermissionData = await request.json();

    // 驗證必要欄位
    if (!data.employeeId) {
      return NextResponse.json({ error: '請選擇員工' }, { status: 400 });
    }

    // 檢查員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: data.employeeId }
    });

    if (!employee) {
      return NextResponse.json({ error: '員工不存在' }, { status: 404 });
    }

    // 檢查是否已有權限設定
    const existingPermission = await prisma.attendancePermission.findUnique({
      where: { employeeId: data.employeeId }
    });

    if (existingPermission) {
      return NextResponse.json({ error: '該員工已有權限設定' }, { status: 409 });
    }

    // 驗證至少有一個權限
    const hasPermissions = Object.values(data.permissions).some(perm => 
      Array.isArray(perm) && perm.length > 0
    );

    if (!hasPermissions) {
      return NextResponse.json({ error: '請至少選擇一個權限' }, { status: 400 });
    }

    // 創建權限設定
    const newPermission = await prisma.attendancePermission.create({
      data: {
        employeeId: data.employeeId,
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

    return NextResponse.json(newPermission, { status: 201 });
  } catch (error) {
    console.error('新增權限設定失敗:', error);
    return NextResponse.json(
      { error: '新增權限設定失敗' },
      { status: 500 }
    );
  }
}
