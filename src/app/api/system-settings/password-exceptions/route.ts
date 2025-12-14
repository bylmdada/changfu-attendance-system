import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';

// GET - 取得密碼例外列表
export async function GET() {
  try {
    // 這裡應該要檢查用戶權限，簡化起見直接返回數據
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
    const userAuth = getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 5000) { // 5KB限制
      return NextResponse.json(
        { error: '密碼例外資料過大' },
        { status: 400 }
      );
    }
    
    const { employeeId, exceptionType, reason, expiresAt } = body;

    if (!employeeId || !exceptionType || !reason) {
      return NextResponse.json(
        { error: '員工ID、例外類型和原因為必填項目' },
        { status: 400 }
      );
    }

    // 檢查員工是否存在
    const employee = await prisma.employee.findFirst({
      where: { id: parseInt(employeeId) }
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
        employeeId: parseInt(employeeId),
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
        employeeId: parseInt(employeeId),
        exceptionType,
        reason,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: 1, // 這裡應該從token中取得當前用戶ID
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
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: '例外ID為必填項目' },
        { status: 400 }
      );
    }

    await prisma.passwordException.delete({
      where: { id: parseInt(id) }
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
