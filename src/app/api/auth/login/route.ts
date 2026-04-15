import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyPassword, generateToken } from '@/lib/auth';
import { recordLoginAttempt, isIPBlocked, getRemainingBlockTime } from '@/lib/security';
import { applyRateLimit, RateLimitError } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { logSecurityEvent, SecurityEventType } from '@/lib/security-monitoring';
import { validateRequest, AuthSchemas } from '@/lib/validation';
import { Prisma } from '@prisma/client';
import { logLogin, LOGIN_STATUS } from '@/lib/login-logger';
import { randomUUID } from 'crypto';

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
      await applyRateLimit(request, '/api/auth/login');
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
      await logLogin(request, username, LOGIN_STATUS.FAILED_NOT_FOUND, undefined, '用戶不存在');
      logSecurityEvent(SecurityEventType.AUTHENTICATION_FAILED, request, {
        message: '用戶不存在',
        username,
        additionalData: { reason: 'user_not_found' }
      });
      return NextResponse.json({ error: '使用者名稱或密碼錯誤' }, { status: 401 });
    }

    // 檢查帳號是否啟用
    if (!user.isActive) {
      await logLogin(request, username, LOGIN_STATUS.FAILED_INACTIVE, user.id, '帳號已停用');
      return NextResponse.json({ error: '帳號已停用，請聯繫管理員' }, { status: 401 });
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      await recordLoginAttempt(request, false);
      await logLogin(request, username, LOGIN_STATUS.FAILED_PASSWORD, user.id, '密碼錯誤');
      logSecurityEvent(SecurityEventType.AUTHENTICATION_FAILED, request, {
        message: '密碼錯誤',
        userId: user.id,
        username: user.username,
        additionalData: { reason: 'invalid_password' }
      });
      return NextResponse.json({ error: '使用者名稱或密碼錯誤' }, { status: 401 });
    }

    // 檢查是否需要 2FA 驗證
    if (user.twoFactorEnabled) {
      const { totpCode } = parseResult;
      
      // 如果沒有提供 TOTP 碼，返回需要 2FA 的回應
      if (!totpCode) {
        return NextResponse.json({
          requires2FA: true,
          message: '請輸入雙因素驗證碼'
        }, { status: 200 });
      }
      
      // 驗證 TOTP 碼
      const { verifyTOTP } = await import('@/lib/totp');
      const { decrypt } = await import('@/lib/encryption');
      
      const secret = decrypt(user.twoFactorSecret!);
      const isValidTOTP = verifyTOTP(totpCode, secret);
      
      if (!isValidTOTP) {
        await logLogin(request, username, LOGIN_STATUS.FAILED_PASSWORD, user.id, '2FA驗證碼錯誤');
        logSecurityEvent(SecurityEventType.AUTHENTICATION_FAILED, request, {
          message: '2FA驗證碼錯誤',
          userId: user.id,
          username: user.username,
          additionalData: { reason: '2fa_invalid' }
        });
        return NextResponse.json({ error: '驗證碼錯誤' }, { status: 401 });
      }
      
      console.log(`✅ [2FA] 用戶 ${user.username} 通過 2FA 驗證`);
    }

    // 記錄成功登入
    await recordLoginAttempt(request, true);
    await logLogin(request, username, LOGIN_STATUS.SUCCESS, user.id);
    logSecurityEvent(SecurityEventType.AUTHENTICATION_SUCCESS, request, {
      message: '用戶成功登入',
      userId: user.id,
      username: user.username,
      additionalData: { role: user.role }
    });

    // 生成唯一的 sessionId，用於單一會話登入控制
    const sessionId = randomUUID();

    const token = generateToken({
      userId: user.id,
      employeeId: user.employeeId, // 這是Employee表的id，用於關聯調班等功能
      username: user.username,
      role: user.role,
      sessionId // 將 sessionId 放入 Token
    });

    // 更新用戶最後登入時間和當前會話 ID（舊會話自動失效）
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        lastLogin: new Date(),
        currentSessionId: sessionId // 儲存當前有效的會話 ID
      }
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        employee: user.employee
      }
    });

    // 改進的Cookie安全設定
    const isProduction = process.env.NODE_ENV === 'production';
    const isHttps = request.headers.get('x-forwarded-proto') === 'https' || 
                    request.url.startsWith('https://');
    
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: isProduction && isHttps, // 只有在HTTPS時才設定secure
      sameSite: 'lax', // 改為 lax 以支援正常導航
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
