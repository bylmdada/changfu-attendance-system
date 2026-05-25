import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, fail } from '@/lib/property-api';
import { canAccessSite } from '@/lib/property-access';
import { parsePositiveInt } from '@/lib/property-query';
import { generateCode128PngBuffer, isCode128Compatible } from '@/lib/property-barcode';

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
    select: { siteId: true, assetCode: true },
  });
  if (!asset) return fail('找不到資產', 404);
  if (!canAccessSite(g.ctx.access, asset.siteId)) return fail('無權限', 403);
  if (!isCode128Compatible(asset.assetCode)) {
    return fail('財產編號不符合 CODE_128 條碼格式', 422);
  }

  let png: Buffer;
  try {
    png = await generateCode128PngBuffer(asset.assetCode);
  } catch (error) {
    console.error('財產條碼產生失敗:', error);
    return fail('條碼產生失敗', 500);
  }
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
