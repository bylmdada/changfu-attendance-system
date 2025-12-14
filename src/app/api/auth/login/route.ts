import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyPassword, generateToken } from '@/lib/auth';
import { recordLoginAttempt, isIPBlocked, getRemainingBlockTime } from '@/lib/security';
import { applyRateLimit, RateLimitError } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { logSecurityEvent, SecurityEventType } from '@/lib/security-monitoring';
import { validateRequest, AuthSchemas } from '@/lib/validation';
import { Prisma } from '@prisma/client';

function buildEmployeeSelect(): Prisma.EmployeeSelect {
  const employeeModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'Employee');
  const fields = new Set((employeeModel?.fields ?? []).map(f => f.name));
  const base: Record<string, boolean> = {
    id: true,
    employeeId: true,
    name: true,
    department: true,
    position: true,
    baseSalary: true,
    hourlyRate: true
  };
  if (fields.has('insuredBase')) base.insuredBase = true;
  if (fields.has('dependents')) base.dependents = true;
  if (fields.has('laborPensionSelfRate')) base.laborPensionSelfRate = true;
  return base as Prisma.EmployeeSelect;
}

export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    try {
      applyRateLimit(request, '/api/auth/login');
    } catch (error) {
      if (error instanceof RateLimitError) {
        logSecurityEvent(SecurityEventType.RATE_LIMIT_EXCEEDED, request, {
          message: `登入速率限制超出: ${error.message}`,
          additionalData: { retryAfter: error.retryAfter }
        });
        return NextResponse.json(
          { error: error.message },
          { 
            status: 429,
            headers: { 'Retry-After': error.retryAfter.toString() }
          }
        );
      }
      throw error;
    }

    // 2. 檢查IP是否被封鎖
    if (await isIPBlocked(request)) {
      const remainingTime = await getRemainingBlockTime(request);
      const remainingMinutes = Math.ceil(remainingTime / (1000 * 60));
      
      logSecurityEvent(SecurityEventType.AUTHENTICATION_FAILED, request, {
        message: 'IP已被封鎖嘗試登入',
        additionalData: { remainingTime: remainingMinutes }
      });
      
      return NextResponse.json(
        { error: `IP已被暫時封鎖，請在${remainingMinutes}分鐘後再試` }, 
        { status: 429 }
      );
    }

    // 3. CSRF保護檢查
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      logSecurityEvent(SecurityEventType.CSRF_VIOLATION, request, {
        message: `CSRF違規: ${csrfResult.error}`,
        additionalData: { endpoint: '/api/auth/login' }
      });
      return NextResponse.json(
        { error: 'CSRF保護違規', details: csrfResult.error },
        { status: 403 }
      );
    }

    // 4. 輸入驗證
    const parseResult = await request.clone().json().catch(() => null);
    if (!parseResult) {
      logSecurityEvent(SecurityEventType.INPUT_VALIDATION_FAILED, request, {
        message: '無效的JSON格式'
      });
      return NextResponse.json({ error: '無效的請求格式' }, { status: 400 });
    }

    const validation = validateRequest(AuthSchemas.login, parseResult);
    if (!validation.success) {
      logSecurityEvent(SecurityEventType.INPUT_VALIDATION_FAILED, request, {
        message: '登入輸入驗證失敗',
        additionalData: { errors: validation.errors }
      });
      return NextResponse.json({ 
        error: '輸入驗證失敗', 
        details: validation.errors 
      }, { status: 400 });
    }

    const { username, password } = validation.data!;

    // DEBUG: log attempt (only in development)
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      console.debug('[debug] LOGIN - attempt username:', username);
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        employee: { select: buildEmployeeSelect() }
      }
    });

    // DEBUG: show whether user was found (only in development)
    if (isDev) {
      console.debug('[debug] LOGIN - user found:', user ? true : false, user ? { id: user.id, username: user.username, role: user.role } : null);
    }

    if (!user) {
      await recordLoginAttempt(request, false);
      logSecurityEvent(SecurityEventType.AUTHENTICATION_FAILED, request, {
        message: '用戶不存在',
        username,
        additionalData: { reason: 'user_not_found' }
      });
      return NextResponse.json({ error: '使用者名稱或密碼錯誤' }, { status: 401 });
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      await recordLoginAttempt(request, false);
      logSecurityEvent(SecurityEventType.AUTHENTICATION_FAILED, request, {
        message: '密碼錯誤',
        userId: user.id,
        username: user.username,
        additionalData: { reason: 'invalid_password' }
      });
      return NextResponse.json({ error: '使用者名稱或密碼錯誤' }, { status: 401 });
    }

    // 記錄成功登入
    await recordLoginAttempt(request, true);
    logSecurityEvent(SecurityEventType.AUTHENTICATION_SUCCESS, request, {
      message: '用戶成功登入',
      userId: user.id,
      username: user.username,
      additionalData: { role: user.role }
    });

    const token = generateToken({
      userId: user.id,
      employeeId: user.employeeId, // 這是Employee表的id，用於關聯調班等功能
      username: user.username,
      role: user.role
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    const response = NextResponse.json({
      success: true,
      token: token, // 添加token到響應中
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        employee: user.employee
      }
    });

    // 改進的Cookie安全設定
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: true, // 始終使用HTTPS
      sameSite: 'strict',
      maxAge: 8 * 60 * 60, // 8 hours in seconds
      path: '/'
    });

    return response;
  } catch (error) {
    console.error('登入錯誤:', error);
    
    // 記錄系統錯誤
    logSecurityEvent(SecurityEventType.SYSTEM_ERROR, request, {
      message: '登入系統錯誤',
      additionalData: { 
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    });
    
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
