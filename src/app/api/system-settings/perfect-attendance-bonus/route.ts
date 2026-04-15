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
import { safeParseJSON } from '@/lib/validation';

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value.map((entry) => (typeof entry === 'string' ? entry.trim() : ''));
  if (normalized.some((entry) => entry.length === 0)) {
    return null;
  }

  return normalized;
}

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

    const bodyResult = await safeParseJSON(request);
    if (!bodyResult.success) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const body = bodyResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const bodyRecord = body as Record<string, unknown>;
    const { enabled, amount, applicableDepartments, excludedLeaveTypes } = bodyRecord;

    // 驗證資料
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: '啟用狀態必須為布林值' }, { status: 400 });
    }

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: '金額必須為正數' }, { status: 400 });
    }

    if (!Array.isArray(applicableDepartments) || applicableDepartments.length === 0) {
      return NextResponse.json({ error: '必須指定至少一個適用部門' }, { status: 400 });
    }

    const normalizedApplicableDepartments = normalizeStringArray(applicableDepartments);
    if (!normalizedApplicableDepartments || normalizedApplicableDepartments.length === 0) {
      return NextResponse.json({ error: '適用部門必須為非空字串陣列' }, { status: 400 });
    }

    const normalizedExcludedLeaveTypes = excludedLeaveTypes === undefined
      ? null
      : normalizeStringArray(excludedLeaveTypes);

    if (excludedLeaveTypes !== undefined && normalizedExcludedLeaveTypes === null) {
      return NextResponse.json({ error: '不計入全勤的假別必須為非空字串陣列' }, { status: 400 });
    }

    const existingConfig = await getPerfectAttendanceConfig();

    const config: PerfectAttendanceConfig = {
      enabled,
      amount,
      applicableDepartments: normalizedApplicableDepartments,
      excludedLeaveTypes: normalizedExcludedLeaveTypes
        ? normalizedExcludedLeaveTypes
        : existingConfig.excludedLeaveTypes || DEFAULT_PERFECT_ATTENDANCE_CONFIG.excludedLeaveTypes
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
