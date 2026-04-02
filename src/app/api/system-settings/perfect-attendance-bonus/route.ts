import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { 
  getPerfectAttendanceConfig, 
  savePerfectAttendanceConfig,
  PerfectAttendanceConfig,
  DEFAULT_PERFECT_ATTENDANCE_CONFIG
} from '@/lib/perfect-attendance';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// GET - 取得全勤獎金設定
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '需要管理員或HR權限' }, { status: 403 });
    }

    const config = await getPerfectAttendanceConfig();

    return NextResponse.json({
      success: true,
      config
    });

  } catch (error) {
    console.error('取得全勤獎金設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 更新全勤獎金設定
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/perfect-attendance-bonus');
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
    
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { enabled, amount, applicableDepartments, excludedLeaveTypes } = body;

    // 驗證資料
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: '啟用狀態必須為布林值' }, { status: 400 });
    }

    if (typeof amount !== 'number' || amount < 0) {
      return NextResponse.json({ error: '金額必須為正數' }, { status: 400 });
    }

    if (!Array.isArray(applicableDepartments) || applicableDepartments.length === 0) {
      return NextResponse.json({ error: '必須指定至少一個適用部門' }, { status: 400 });
    }

    const config: PerfectAttendanceConfig = {
      enabled,
      amount,
      applicableDepartments,
      excludedLeaveTypes: excludedLeaveTypes || DEFAULT_PERFECT_ATTENDANCE_CONFIG.excludedLeaveTypes
    };

    await savePerfectAttendanceConfig(config);

    return NextResponse.json({
      success: true,
      message: '全勤獎金設定已更新',
      config
    });

  } catch (error) {
    console.error('更新全勤獎金設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
