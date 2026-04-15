import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

// POST - legacy 2FA 驗證端點已停用
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    return NextResponse.json({
      error: '此驗證端點已停用，請改用 /api/auth/login 或 /api/auth/2fa/* 安全流程。',
    }, { status: 410 });
  } catch (error) {
    console.error('2FA 驗證失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
