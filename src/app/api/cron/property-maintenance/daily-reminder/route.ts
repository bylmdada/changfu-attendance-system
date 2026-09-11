/**
 * 每日 08:00：提醒到期或即將到期之維護任務（§12）。
 * cron 範例：0 8 * * * curl -X POST -H "x-cron-secret: $CRON_SECRET" .../daily-reminder
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { hasValidCronSecret, sendDailyReminders } from '@/lib/property-cron-service';
import { systemLogger } from '@/lib/logger';

export const maxDuration = 120;

async function handle(request: NextRequest) {
  if (!hasValidCronSecret(request)) {
    const user = await getUserFromRequest(request);
    if (!user || !['ADMIN', 'HR'].includes(user.role)) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
  }
  try {
    const result = await sendDailyReminders();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    systemLogger.error('daily-reminder cron 失敗', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
