import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { guard } from '@/lib/property-api';
import { canManageSite, siteWhere } from '@/lib/property-access';
import { parsePositiveInt } from '@/lib/property-query';
import { generateCode128DataUrl, isCode128Compatible } from '@/lib/property-barcode';

export const maxDuration = 120;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}

/**
 * POST { assetIds:number[] } 或 { siteId } → 可列印 CODE_128 條碼標籤頁
 *（現場財產標籤為 CODE_128 一維條碼；瀏覽器列印）。
 */
export async function POST(request: NextRequest) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const body = await request.json().catch(() => ({}));
  const where: Record<string, unknown> = { ...siteWhere(g.ctx.access), isActive: true };
  const manageableSiteIds = Array.from(g.ctx.access.roleBySite.entries())
    .filter(([, role]) => role === 'ADMIN')
    .map(([siteId]) => siteId);
  if (!g.ctx.access.isGlobalAdmin && manageableSiteIds.length === 0) {
    return new NextResponse('僅財產管理員可列印標籤', { status: 403 });
  }
  if (!g.ctx.access.isGlobalAdmin) where.siteId = { in: manageableSiteIds };
  if (Array.isArray(body?.assetIds) && body.assetIds.length) {
    const assetIds = (body.assetIds as unknown[])
      .map((n: unknown) => parsePositiveInt(n))
      .filter((n: number | null): n is number => n !== null);
    if (assetIds.length === 0) {
      return new NextResponse('沒有可列印的資產', { status: 400 });
    }
    where.id = { in: assetIds };
  } else if (body?.siteId) {
    const siteId = parsePositiveInt(body.siteId);
    if (!siteId) {
      return new NextResponse('siteId 參數錯誤', { status: 400 });
    }
    if (!canManageSite(g.ctx.access, siteId)) {
      return new NextResponse('無權限', { status: 403 });
    }
    where.siteId = siteId;
  }

  const assets = await prisma.propertyAsset.findMany({
    where,
    orderBy: { assetCode: 'asc' },
    take: 500,
    select: { assetCode: true, name: true, location: true },
  });

  const cards = await Promise.all(
    assets.map(async (a) => {
      if (!isCode128Compatible(a.assetCode)) {
        return `<div class="card invalid">
          <div class="invalid-title">無法產生 CODE_128</div>
          <div class="code">${esc(a.assetCode)}</div>
          <div class="name">${esc(a.name)}</div>
          <div class="loc">${esc(a.location ?? '')}</div>
        </div>`;
      }
      let bc: string;
      try {
        bc = await generateCode128DataUrl(a.assetCode);
      } catch (error) {
        console.error('列印財產條碼失敗:', { assetCode: a.assetCode, error });
        return `<div class="card invalid">
          <div class="invalid-title">條碼產生失敗</div>
          <div class="code">${esc(a.assetCode)}</div>
          <div class="name">${esc(a.name)}</div>
          <div class="loc">${esc(a.location ?? '')}</div>
        </div>`;
      }
      return `<div class="card">
        <img src="${bc}" alt="${esc(a.assetCode)}" />
        <div class="name">${esc(a.name)}</div>
        <div class="loc">${esc(a.location ?? '')}</div>
      </div>`;
    })
  );

  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>財產條碼標籤（${assets.length}）</title>
<style>
  body{font-family:"Microsoft JhengHei",sans-serif;margin:12px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .card{border:1px solid #999;border-radius:6px;padding:8px;text-align:center;page-break-inside:avoid}
  .card img{width:100%;max-width:230px;height:auto}
  .name{font-size:12px;font-weight:600;margin-top:2px}
  .loc{font-size:11px;color:#555}
  .code{font-size:12px;margin:8px 0;word-break:break-all}
  .invalid{border-color:#b91c1c;color:#111}
  .invalid-title{font-size:12px;font-weight:700;color:#b91c1c}
  .bar{margin-bottom:10px}
  @media print{.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">列印</button> 共 ${assets.length} 筆（CODE_128）</div>
<div class="grid">${cards.join('')}</div>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
