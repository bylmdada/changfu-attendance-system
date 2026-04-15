import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { safeParseJSON } from '@/lib/validation';

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function parseOptionalDate(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  return parsedDate;
}

async function requireAdmin(request: NextRequest) {
  const userAuth = await getUserFromRequest(request);
  if (!userAuth) {
    return NextResponse.json({ error: '未授權' }, { status: 401 });
  }

  if (userAuth.role !== 'ADMIN') {
    return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
  }

  return null;
}

// GET - 取得密碼例外列表
export async function GET(request: NextRequest) {
  try {
    const authError = await requireAdmin(request);
    if (authError) {
      return authError;
    }

    const exceptions = await prisma.passwordException.findMany({
      include: {
        employee: {
          select: {
            employeeId: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const formattedExceptions = exceptions.map((exception) => ({
      id: exception.id,
      employeeId: exception.employeeId,
      employeeName: exception.employee?.name || '未知員工',
      employeeCode: exception.employee?.employeeId || '未知編號',
      exceptionType: exception.exceptionType,
      reason: exception.reason,
      createdBy: exception.createdBy,
      createdAt: exception.createdAt.toISOString(),
      expiresAt: exception.expiresAt?.toISOString(),
      isActive: exception.isActive
    }));

    return NextResponse.json({ 
      success: true, 
      exceptions: formattedExceptions 
    });

  } catch (error) {
    console.error('取得密碼例外失敗:', error);
    return NextResponse.json(
      { error: '取得密碼例外失敗' },
      { status: 500 }
    );
  }
}

// POST - 新增密碼例外
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/password-exceptions');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '密碼例外操作過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.retryAfter 
        },
        { 
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          }
        }
      );
    }

    // 2. CSRF保護檢查
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    // 3. 管理員權限驗證
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
      return NextResponse.json(
        { error: '請提供有效的設定資料' },
        { status: 400 }
      );
    }
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 5000) { // 5KB限制
      return NextResponse.json(
        { error: '密碼例外資料過大' },
        { status: 400 }
      );
    }
    
    const employeeId = body.employeeId;
    const exceptionType = body.exceptionType;
    const reason = body.reason;
    const expiresAt = body.expiresAt;
    const parsedEmployeeId = parsePositiveInteger(employeeId);
    const parsedExpiresAt = parseOptionalDate(expiresAt);

    if (!employeeId || !exceptionType || !reason) {
      return NextResponse.json(
        { error: '員工ID、例外類型和原因為必填項目' },
        { status: 400 }
      );
    }

    if (!parsedEmployeeId) {
      return NextResponse.json(
        { error: '員工ID格式無效' },
        { status: 400 }
      );
    }

    if (typeof exceptionType !== 'string' || typeof reason !== 'string') {
      return NextResponse.json(
        { error: '例外類型和原因格式無效' },
        { status: 400 }
      );
    }

    if (expiresAt && parsedExpiresAt === undefined) {
      return NextResponse.json(
        { error: '到期日期格式無效' },
        { status: 400 }
      );
    }

    // 檢查員工是否存在
    const employee = await prisma.employee.findFirst({
      where: { id: parsedEmployeeId }
    });

    if (!employee) {
      return NextResponse.json(
        { error: '找不到指定的員工' },
        { status: 404 }
      );
    }

    // 檢查是否已經有相同類型的例外
    const existingException = await prisma.passwordException.findFirst({
      where: {
        employeeId: parsedEmployeeId,
        exceptionType: exceptionType,
        isActive: true
      }
    });

    if (existingException) {
      return NextResponse.json(
        { error: '該員工已經有相同類型的例外設定' },
        { status: 400 }
      );
    }

    const exception = await prisma.passwordException.create({
      data: {
        employeeId: parsedEmployeeId,
        exceptionType,
        reason,
        expiresAt: parsedExpiresAt ?? null,
        createdBy: userAuth.userId,
        isActive: true
      },
      include: {
        employee: {
          select: {
            employeeId: true,
            name: true
          }
        }
      }
    });

    const formattedException = {
      id: exception.id,
      employeeId: exception.employeeId,
      employeeName: exception.employee?.name || '未知員工',
      employeeCode: exception.employee?.employeeId || '未知編號',
      exceptionType: exception.exceptionType,
      reason: exception.reason,
      createdBy: exception.createdBy,
      createdAt: exception.createdAt.toISOString(),
      expiresAt: exception.expiresAt?.toISOString(),
      isActive: exception.isActive
    };

    return NextResponse.json({ 
      success: true, 
      exception: formattedException 
    });

  } catch (error) {
    console.error('新增密碼例外失敗:', error);
    return NextResponse.json(
      { error: '新增密碼例外失敗' },
      { status: 500 }
    );
  }
}

// DELETE - 刪除密碼例外
export async function DELETE(request: NextRequest) {
  try {
    const authError = await requireAdmin(request);
    if (authError) {
      return authError;
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
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
      return NextResponse.json(
        { error: '請提供有效的設定資料' },
        { status: 400 }
      );
    }

    const { id } = body;
    const parsedId = parsePositiveInteger(id);

    if (!id) {
      return NextResponse.json(
        { error: '例外ID為必填項目' },
        { status: 400 }
      );
    }

    if (!parsedId) {
      return NextResponse.json(
        { error: '例外ID格式無效' },
        { status: 400 }
      );
    }

    await prisma.passwordException.delete({
      where: { id: parsedId }
    });

    return NextResponse.json({ 
      success: true, 
      message: '例外刪除成功' 
    });

  } catch (error) {
    console.error('刪除密碼例外失敗:', error);
    return NextResponse.json(
      { error: '刪除密碼例外失敗' },
      { status: 500 }
    );
  }
}
