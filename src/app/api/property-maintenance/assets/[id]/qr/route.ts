import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canAccessSite } from '@/lib/property-access';
import { parsePositiveInt } from '@/lib/property-query';
import { buildPropertyBarcodeValue } from '@/lib/property-barcode';

// GET：產生資產 QR（dataURL，內容為「據點代碼:財產編號」，與單張條碼一致；財產編號只在同一據點內唯一）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const { id } = await params;
  const assetId = parsePositiveInt(id);
  if (!assetId) return fail('資產 ID 錯誤');
  const asset = await prisma.propertyAsset.findUnique({
    where: { id: assetId },
    select: { id: true, siteId: true, assetCode: true, name: true, site: { select: { code: true } } },
  });
  if (!asset) return fail('找不到資產', 404);
  if (!canAccessSite(g.ctx.access, asset.siteId)) return fail('無權限', 403);

  const dataUrl = await QRCode.toDataURL(buildPropertyBarcodeValue(asset.site.code, asset.assetCode), {
    width: 320,
    margin: 1,
  });
  return ok({ assetCode: asset.assetCode, name: asset.name, dataUrl });
}
