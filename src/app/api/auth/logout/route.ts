import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/auth/logout');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (user?.sessionId) {
      await prisma.user.updateMany({
        where: { id: user.userId, currentSessionId: user.sessionId },
        data: { currentSessionId: null },
      });
    }
    const response = NextResponse.json({ success: true, message: '登出成功' });
    
    // 清除 Cookie
    response.cookies.delete('token');
    response.cookies.delete('auth-token');
    
    return response;
  } catch (error) {
    console.error('登出錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
