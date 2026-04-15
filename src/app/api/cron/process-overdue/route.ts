/**
 * 逾期自動處理 Cron API
 * 可由外部 cron job 或 Vercel Cron 呼叫
 * 
 * 建議執行頻率：每小時一次 或 每日兩次（09:00, 18:00）
 * 
 * Vercel Cron 設定範例（vercel.json）：
 * {
 *   "crons": [{
 *     "path": "/api/cron/process-overdue",
 *     "schedule": "0 9,18 * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { processOverdueApprovals, getOverdueSettings } from '@/lib/approval-scheduler';

function getConfiguredCronSecret() {
  const secret = process.env.CRON_SECRET?.trim();
  return secret ? secret : null;
}

function hasValidCronSecret(request: NextRequest, configuredSecret: string | null) {
  if (!configuredSecret) {
    return false;
  }

  const authHeader = request.headers.get('Authorization');
  const headerSecret = request.headers.get('x-cron-secret');
  const querySecret = request.nextUrl.searchParams.get('secret');

  return headerSecret === configuredSecret || querySecret === configuredSecret || authHeader === `Bearer ${configuredSecret}`;
}

export async function GET(request: NextRequest) {
  try {
    // Vercel Cron 會帶有特殊 header
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';
    const configuredSecret = getConfiguredCronSecret();
    
    // 驗證權限
    if (!isVercelCron && !hasValidCronSecret(request, configuredSecret)) {
      return NextResponse.json(
        { error: '未授權', message: '請提供有效的 cron secret' },
        { status: 401 }
      );
    }

    // 取得設定狀態
    const settings = await getOverdueSettings();

    // 執行處理
    const result = await processOverdueApprovals();

    return NextResponse.json({
      success: true,
      settings: {
        enabled: settings.enabled,
        autoEscalateEnabled: settings.autoEscalateEnabled,
        autoRejectEnabled: settings.autoRejectEnabled,
        dailyReportEnabled: settings.dailyReportEnabled
      },
      result
    });

  } catch (error) {
    console.error('Cron 執行失敗:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: '處理失敗',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// 也支援 POST 方法（方便外部呼叫）
export async function POST(request: NextRequest) {
  return GET(request);
}
