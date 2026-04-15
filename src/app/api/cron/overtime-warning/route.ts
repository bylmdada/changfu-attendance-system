/**
 * 加班警示 CRON API
 * 
 * 用於定期掃描員工加班時數並發送警示通知
 * 可由 CRON 作業或手動觸發
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { runOvertimeWarningCheck, OVERTIME_THRESHOLDS } from '@/lib/overtime-warning';
import { systemLogger } from '@/lib/logger';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// 驗證 CRON 秘鑰（可選）。若未配置或不匹配，仍需走一般管理權限驗證。
function hasValidCronSecret(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }
  
  const authHeader = request.headers.get('x-cron-secret');
  return authHeader === cronSecret;
}

// POST - 執行加班警示檢查
export async function POST(request: NextRequest) {
  try {
    if (!hasValidCronSecret(request)) {
      const decoded = await getUserFromRequest(request);
      if (!decoded) {
        return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
      }

      if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
        return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
      }
    }

    // 解析請求參數
    let year: number | undefined;
    let month: number | undefined;

    const parsedBody = await safeParseJSON(request);
    if (parsedBody.success) {
      if (!isPlainObject(parsedBody.data)) {
        return NextResponse.json({ error: '請提供有效的加班警示檢查資料' }, { status: 400 });
      }

      year = typeof parsedBody.data.year === 'number' ? parsedBody.data.year : undefined;
      month = typeof parsedBody.data.month === 'number' ? parsedBody.data.month : undefined;
    } else if (parsedBody.error !== 'empty_body') {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    systemLogger.info('收到加班警示檢查請求', {
      context: { year, month, source: 'api' }
    });

    // 執行檢查
    const result = await runOvertimeWarningCheck(year, month);

    return NextResponse.json({
      success: true,
      message: `掃描完成：${result.scannedEmployees} 名員工，${result.criticalCount} 人超過法定上限（${OVERTIME_THRESHOLDS.LEGAL_LIMIT}小時），${result.warningCount} 人達警戒線（${OVERTIME_THRESHOLDS.WARNING}小時）`,
      data: {
        ...result,
        thresholds: OVERTIME_THRESHOLDS
      }
    });
  } catch (error) {
    systemLogger.error('加班警示檢查失敗', {
      error: error instanceof Error ? error : new Error(String(error))
    });

    return NextResponse.json(
      { error: '執行加班警示檢查時發生錯誤' },
      { status: 500 }
    );
  }
}

// GET - 取得加班警示狀態（預覽，不發送通知）
export async function GET(request: NextRequest) {
  try {
    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : now.getFullYear();
    const month = searchParams.get('month') ? parseInt(searchParams.get('month')!) : (now.getMonth() + 1);

    // 使用 overtime-warning 模組取得摘要
    const { getOvertimeSummaryWithAlerts } = await import('@/lib/overtime-warning');
    const summary = await getOvertimeSummaryWithAlerts(year, month);

    return NextResponse.json({
      success: true,
      period: { year, month },
      thresholds: OVERTIME_THRESHOLDS,
      summary: summary.summary,
      employees: summary.employees
    });
  } catch (error) {
    systemLogger.error('取得加班警示狀態失敗', {
      error: error instanceof Error ? error : new Error(String(error))
    });

    return NextResponse.json(
      { error: '取得加班警示狀態時發生錯誤' },
      { status: 500 }
    );
  }
}
