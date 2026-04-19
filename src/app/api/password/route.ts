import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, hashPassword, verifyPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { evaluatePasswordStrength } from '@/lib/password-policy';
import { getStoredPasswordPolicy } from '@/lib/password-policy-store';
import { getPasswordReuseViolation } from '@/lib/password-reuse';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function validatePasswordWithStoredPolicy(password: string) {
  const passwordPolicy = await getStoredPasswordPolicy();
  return evaluatePasswordStrength(password, passwordPolicy);
}

// 修改自己的密碼
export async function PUT(request: NextRequest) {
  try {
    // Rate limiting - critical for password change operations
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '當前密碼和新密碼為必填' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '當前密碼和新密碼為必填' }, { status: 400 });
    }

    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: '當前密碼和新密碼為必填' }, { status: 400 });
    }

    const passwordValidation = await validatePasswordWithStoredPolicy(newPassword);
    if (!passwordValidation.passesPolicy) {
      return NextResponse.json({ 
        error: '密碼不符合安全要求', 
        details: passwordValidation.violations
      }, { status: 400 });
    }

    // 查找用戶
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    // 驗證當前密碼
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      return NextResponse.json({ error: '當前密碼錯誤' }, { status: 400 });
    }

    const passwordPolicy = await getStoredPasswordPolicy();
    const passwordReuseViolation = await getPasswordReuseViolation(
      user.id,
      newPassword,
      user.passwordHash,
      passwordPolicy
    );
    if (passwordReuseViolation) {
      return NextResponse.json({
        error: '密碼不符合安全要求',
        details: [passwordReuseViolation]
      }, { status: 400 });
    }

    // 加密新密碼
    const hashedNewPassword = await hashPassword(newPassword);

    // 更新密碼
    await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        passwordHash: hashedNewPassword,
        currentSessionId: null,
        passwordHistories: {
          create: {
            passwordHash: user.passwordHash
          }
        }
      }
    });

    return NextResponse.json({ 
      success: true, 
      message: '密碼修改成功，請重新登入',
      requireRelogin: true
    });
  } catch (error) {
    console.error('修改密碼失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 管理員重置用戶密碼
export async function POST(request: NextRequest) {
  try {
    // Rate limiting - critical for password reset operations
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);

    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '用戶ID和新密碼為必填' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '用戶ID和新密碼為必填' }, { status: 400 });
    }

    const userId = typeof body.userId === 'string'
      ? body.userId.trim()
      : typeof body.userId === 'number'
        ? String(body.userId)
        : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!userId || !newPassword) {
      return NextResponse.json({ error: '用戶ID和新密碼為必填' }, { status: 400 });
    }

    const parsedUserId = parseIntegerQueryParam(userId, { min: 1, max: 99999999 });
    if (!parsedUserId.isValid || parsedUserId.value === null) {
      return NextResponse.json({ error: '用戶ID格式無效' }, { status: 400 });
    }

    const passwordValidation = await validatePasswordWithStoredPolicy(newPassword);
    if (!passwordValidation.passesPolicy) {
      return NextResponse.json({ 
        error: '密碼不符合安全要求', 
        details: passwordValidation.violations 
      }, { status: 400 });
    }

    // 查找目標用戶
    const targetUser = await prisma.user.findUnique({
      where: { id: parsedUserId.value },
      include: { employee: true }
    });

    if (!targetUser) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    const passwordPolicy = await getStoredPasswordPolicy();
    const passwordReuseViolation = await getPasswordReuseViolation(
      targetUser.id,
      newPassword,
      targetUser.passwordHash,
      passwordPolicy
    );
    if (passwordReuseViolation) {
      return NextResponse.json({
        error: '密碼不符合安全要求',
        details: [passwordReuseViolation]
      }, { status: 400 });
    }

    // 加密新密碼
    const hashedNewPassword = await hashPassword(newPassword);

    // 更新密碼
    await prisma.user.update({
      where: { id: parsedUserId.value },
      data: {
        passwordHash: hashedNewPassword,
        currentSessionId: null,
        passwordHistories: {
          create: {
            passwordHash: targetUser.passwordHash
          }
        }
      }
    });

    return NextResponse.json({ 
      success: true, 
      message: `已重置用戶 ${targetUser.employee?.name || targetUser.username} 的密碼` 
    });
  } catch (error) {
    console.error('重置密碼失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
