import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken, hashPassword, verifyPassword, validatePassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: '當前密碼和新密碼為必填' }, { status: 400 });
    }

    // 驗證密碼複雜度
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return NextResponse.json({ 
        error: '密碼不符合安全要求', 
        details: passwordValidation.errors 
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

    // 加密新密碼
    const hashedNewPassword = await hashPassword(newPassword);

    // 更新密碼
    await prisma.user.update({
      where: { id: decoded.userId },
      data: { passwordHash: hashedNewPassword }
    });

    return NextResponse.json({ 
      success: true, 
      message: '密碼修改成功' 
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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || (decoded.role !== 'ADMIN' && decoded.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { userId, newPassword } = await request.json();

    if (!userId || !newPassword) {
      return NextResponse.json({ error: '用戶ID和新密碼為必填' }, { status: 400 });
    }

    // 驗證密碼複雜度
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return NextResponse.json({ 
        error: '密碼不符合安全要求', 
        details: passwordValidation.errors 
      }, { status: 400 });
    }

    // 查找目標用戶
    const targetUser = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      include: { employee: true }
    });

    if (!targetUser) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    // 加密新密碼
    const hashedNewPassword = await hashPassword(newPassword);

    // 更新密碼
    await prisma.user.update({
      where: { id: parseInt(userId) },
      data: { passwordHash: hashedNewPassword }
    });

    return NextResponse.json({ 
      success: true, 
      message: `已重置用戶 ${targetUser.employee.name} 的密碼` 
    });
  } catch (error) {
    console.error('重置密碼失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
