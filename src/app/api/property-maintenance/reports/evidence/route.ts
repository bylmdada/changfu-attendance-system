import { NextRequest } from 'next/server';
import { guard, fail } from '@/lib/property-api';
import { canSuperviseSite } from '@/lib/property-access';
import { buildEvidenceSingle, buildEvidenceBatch } from '@/lib/property-report-service';
import { xlsxResponse } from '@/lib/property-report-response';
import { parsePositiveInt } from '@/lib/property-query';

export const maxDuration = 300;

// GET ?siteId&assetCode → 單一輔具佐證 .xlsx（§15，檔名含財產編號 §23）
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const sp = request.nextUrl.searchParams;
  const siteId = parsePositiveInt(sp.get('siteId'));
  const assetCode = sp.get('assetCode')?.trim();
  if (!siteId || !assetCode) return fail('參數錯誤：需 siteId / assetCode');
  if (!canSuperviseSite(g.ctx.access, siteId)) return fail('需主管或稽核權限', 403);
  try {
    const r = await buildEvidenceSingle(siteId, assetCode);
    if (!r) return fail('查無此財產', 404);
    return xlsxResponse(r.buffer, r.filename);
  } catch (e) {
    console.error('佐證產生失敗:', e);
    return fail('系統錯誤', 500);
  }
}

// POST { siteId, assetCodes?:string[] } → 批次佐證（每資產一分頁，§15）
export async function POST(request: NextRequest) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const body = await request.json().catch(() => null);
  const siteId = parsePositiveInt(body?.siteId);
  if (!siteId) return fail('參數錯誤：需 siteId');
  if (!canSuperviseSite(g.ctx.access, siteId)) return fail('需主管或稽核權限', 403);
  const assetCodes = Array.isArray(body?.assetCodes)
    ? body.assetCodes.map((x: unknown) => String(x))
    : undefined;
  try {
    const r = await buildEvidenceBatch(siteId, assetCodes);
    return xlsxResponse(r.buffer, r.filename);
  } catch (e) {
    console.error('批次佐證產生失敗:', e);
    return fail('系統錯誤', 500);
  }
}
