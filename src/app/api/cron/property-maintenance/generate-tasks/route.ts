/**
 * 每週三 08:00：依財產主檔與維護頻率自動產生維護任務（§4、§23）。
 * cron 範例：0 8 * * 3 curl -X POST -H "x-cron-secret: $CRON_SECRET" .../generate-tasks
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { hasValidCronSecret, generateMaintenanceTasks } from '@/lib/property-cron-service';

export const maxDuration = 120;

async function handle(request: NextRequest) {
  if (!hasValidCronSecret(request)) {
    const user = await getUserFromRequest(request);
    if (!user || !['ADMIN', 'HR'].includes(user.role)) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
  }
  try {
    const result = await generateMaintenanceTasks();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('generate-tasks cron 失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
