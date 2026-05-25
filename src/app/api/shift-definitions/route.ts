import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { listShiftDefinitions } from '@/lib/shift-definition-service';

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/shift-definitions');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const shifts = await listShiftDefinitions({ includeInactive });

    return NextResponse.json({
      success: true,
      shifts,
    });
  } catch (error) {
    console.error('取得班別定義失敗:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}
