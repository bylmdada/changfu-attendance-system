import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { safeParseJSON } from '@/lib/validation';

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePermissionList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的權限設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;
    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的權限設定資料' }, { status: 400 });
    }

    const employeeId = typeof data.employeeId === 'number' ? data.employeeId : undefined;
    const permissions: AttendancePermissionData['permissions'] | undefined = isPlainObject(data.permissions)
      ? {
          leaveRequests: normalizePermissionList(data.permissions.leaveRequests),
          overtimeRequests: normalizePermissionList(data.permissions.overtimeRequests),
          shiftExchanges: normalizePermissionList(data.permissions.shiftExchanges),
          scheduleManagement: normalizePermissionList(data.permissions.scheduleManagement),
        }
      : undefined;

    // 驗證必要欄位
    if (!employeeId) {
      return NextResponse.json({ error: '請選擇員工' }, { status: 400 });
    }

    // 檢查員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId }
    });

    if (!employee) {
      return NextResponse.json({ error: '員工不存在' }, { status: 404 });
    }

    // 檢查是否已有權限設定
    const existingPermission = await prisma.attendancePermission.findUnique({
      where: { employeeId }
    });

    if (existingPermission) {
      return NextResponse.json({ error: '該員工已有權限設定' }, { status: 409 });
    }

    // 驗證至少有一個權限
    const hasPermissions = permissions && Object.values(permissions).some(perm => 
      Array.isArray(perm) && perm.length > 0
    );

    if (!hasPermissions) {
      return NextResponse.json({ error: '請至少選擇一個權限' }, { status: 400 });
    }

    // 創建權限設定
    const newPermission = await prisma.attendancePermission.create({
      data: {
        employeeId,
        permissions: permissions || {
          leaveRequests: [],
          overtimeRequests: [],
          shiftExchanges: [],
          scheduleManagement: [],
        }
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
