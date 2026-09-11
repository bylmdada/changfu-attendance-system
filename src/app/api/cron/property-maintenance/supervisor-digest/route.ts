/**
 * 每週四 08:00：彙整週三完成與待辦清冊寄主管（§13）。
 * cron 範例：0 8 * * 4 curl -X POST -H "x-cron-secret: $CRON_SECRET" .../supervisor-digest
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { hasValidCronSecret, sendSupervisorDigest } from '@/lib/property-cron-service';
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
    const result = await sendSupervisorDigest();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    systemLogger.error('supervisor-digest cron 失敗', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
