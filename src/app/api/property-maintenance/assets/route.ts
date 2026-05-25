import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canAccessSite, siteWhere, canManageSite } from '@/lib/property-access';
import { normalizeFrequencyDays } from '@/lib/property-maintenance-utils';
import { parseBoundedPositiveInt, parsePositiveInt } from '@/lib/property-query';
import { normalizePropertyAttachmentPath } from '@/lib/property-attachment-paths';
import { getOrCreateDefaultPropertySite } from '@/lib/property-site-service';
import { isCode128Compatible } from '@/lib/property-barcode';

const MAX_ASSET_PAGE = 1000000;

function stringField(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function dateField(value: unknown): Date | null {
  const trimmed = stringField(value);
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

// GET：資產清冊（site-scoped，?q ?location ?siteId ?page ?pageSize）
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const sp = request.nextUrl.searchParams;
  const q = sp.get('q')?.trim();
  const location = sp.get('location')?.trim();
  const siteIdParam = sp.get('siteId');
  const page = parseBoundedPositiveInt(sp.get('page'), 1, MAX_ASSET_PAGE);
  const pageSize = parseBoundedPositiveInt(sp.get('pageSize'), 50, 200);

  const where: Record<string, unknown> = { ...siteWhere(g.ctx.access), isActive: true };
  if (siteIdParam) {
    const siteId = parsePositiveInt(siteIdParam);
    if (!siteId) return ok({ total: 0, page, pageSize, items: [] });
    if (!canAccessSite(g.ctx.access, siteId)) return ok({ total: 0, page, pageSize, items: [] });
    where.siteId = siteId;
  }
  if (location) where.location = { contains: location };
  if (q) {
    where.OR = [{ assetCode: { contains: q } }, { name: { contains: q } }, { managerName: { contains: q } }];
  }

  const [total, items] = await Promise.all([
    prisma.propertyAsset.count({ where }),
    prisma.propertyAsset.findMany({
      where,
      orderBy: { assetCode: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { site: { select: { id: true, name: true } } },
    }),
  ]);
  return ok({ total, page, pageSize, items });
}

// POST：新增資產
export async function POST(request: NextRequest) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const body = await request.json().catch(() => null);
  let siteId = parsePositiveInt(body?.siteId);
  const assetCode = stringField(body?.assetCode);
  const name = stringField(body?.name);
  if (!assetCode || !name) {
    return fail('缺少必填欄位：assetCode / name');
  }
  if (!isCode128Compatible(assetCode)) {
    return fail('財產編號不符合 CODE_128 條碼格式（請使用英數、符號，最多 80 字元）');
  }
  if (!siteId) {
    if (!g.ctx.access.isGlobalAdmin) return fail('缺少必填欄位：siteId');
    const defaultSite = await getOrCreateDefaultPropertySite();
    siteId = defaultSite.id;
  }
  if (!canManageSite(g.ctx.access, siteId)) return fail('無權限', 403);
  const site = await prisma.propertySite.findUnique({
    where: { id: siteId },
    select: { id: true, isActive: true },
  });
  if (!site) return fail('找不到據點', 404);
  if (!site.isActive) return fail('據點已停用，無法新增資產', 403);

  const photoPath = body?.photoPath ? normalizePropertyAttachmentPath(body.photoPath) : null;
  if (body?.photoPath && !photoPath) return fail('財產照片路徑無效');
  const acquiredDate = dateField(body?.acquiredDate);
  const nextMaintenanceDate = dateField(body?.nextMaintenanceDate);
  if (body?.acquiredDate && !acquiredDate) return fail('取得日期格式錯誤');
  if (body?.nextMaintenanceDate && !nextMaintenanceDate) return fail('應維護日期格式錯誤');

  try {
    const asset = await prisma.propertyAsset.create({
      data: {
        siteId,
        assetCode,
        name,
        location: stringField(body.location),
        managerName: stringField(body.managerName),
        maintenanceFrequency: stringField(body.maintenanceFrequency),
        frequencyDays: normalizeFrequencyDays(stringField(body.maintenanceFrequency)),
        photoPath,
        acquiredDate,
        nextMaintenanceDate,
      },
    });
    return ok(asset, '已新增資產');
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      return fail('該據點已有相同財產編號', 409);
    }
    console.error('新增資產失敗:', e);
    return fail('系統錯誤', 500);
  }
}
