import { NextRequest } from 'next/server';
import { guard, fail } from '@/lib/property-api';
import { canAccessSite, siteWhere } from '@/lib/property-access';
import { buildMaintenanceHistoryReport } from '@/lib/property-report-service';
import { csvResponse, xlsxResponse } from '@/lib/property-report-response';
import { parsePositiveInt } from '@/lib/property-query';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;

  const sp = request.nextUrl.searchParams;
  const assetId = parsePositiveInt(sp.get('assetId'));
  const siteId = parsePositiveInt(sp.get('siteId'));
  const format = (sp.get('format') || 'xlsx').toLowerCase();
  if (sp.has('assetId') && !assetId) return fail('財產 ID 錯誤');
  if (sp.has('siteId') && !siteId) return fail('據點 ID 錯誤');
  if (format !== 'xlsx' && format !== 'csv') {
    return fail('匯出格式錯誤，僅支援 csv 或 xlsx');
  }

  if (siteId && !canAccessSite(g.ctx.access, siteId)) {
    return fail('無權限', 403);
  }

  try {
    const report = await buildMaintenanceHistoryReport({
      assetId: assetId ?? undefined,
      siteId: siteId ?? undefined,
      siteWhere: siteWhere(g.ctx.access),
    });

    if (!report) return fail('查無此財產', 404);
    if (report.asset && !canAccessSite(g.ctx.access, report.asset.siteId)) {
      return fail('無權限', 403);
    }

    return format === 'csv'
      ? csvResponse(report.csvContent, report.csvFilename)
      : xlsxResponse(report.xlsxBuffer, report.xlsxFilename);
  } catch (error) {
    console.error('財產維護歷程總表產生失敗:', error);
    return fail('系統錯誤', 500);
  }
}
