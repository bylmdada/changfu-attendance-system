import { NextRequest } from 'next/server';
import { guard, fail } from '@/lib/property-api';
import { canSuperviseSite } from '@/lib/property-access';
import { buildMonthlyReport } from '@/lib/property-report-service';
import { xlsxResponse } from '@/lib/property-report-response';
import { parsePositiveInt } from '@/lib/property-query';

export const maxDuration = 120;

// GET ?siteId&year&month → 月維護紀錄表 .xlsx（§14）
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const sp = request.nextUrl.searchParams;
  const siteId = parsePositiveInt(sp.get('siteId'));
  const year = parsePositiveInt(sp.get('year'));
  const month = parsePositiveInt(sp.get('month'));
  if (!siteId || !year || !month || month > 12) {
    return fail('參數錯誤：需 siteId / year / month');
  }
  if (!canSuperviseSite(g.ctx.access, siteId)) return fail('需主管或稽核權限', 403);
  try {
    const { buffer, filename } = await buildMonthlyReport(siteId, year, month);
    return xlsxResponse(buffer, filename);
  } catch (e) {
    console.error('月報產生失敗:', e);
    return fail('系統錯誤', 500);
  }
}
