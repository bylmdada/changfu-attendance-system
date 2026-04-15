import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/auth/forgot-password');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Email 重設功能尚未啟用，請聯繫系統管理員協助重設密碼。' },
      { status: 503 }
    );
  } catch (error) {
    console.error('Forgot password request failed:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}