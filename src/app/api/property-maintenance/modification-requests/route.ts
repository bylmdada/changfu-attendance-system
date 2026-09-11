import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canMaintainSite, maintainableSiteWhere, siteWhere } from '@/lib/property-access';
import { parsePositiveInt } from '@/lib/property-query';
import {
  PROPERTY_EDITABLE_FIELDS,
  PROPERTY_FIELD_LABEL,
  type PropertyEditableField,
} from '@/lib/property-modification-fields';
import { normalizeFrequencyDays } from '@/lib/property-maintenance-utils';

// GET：修改申請清單（site-scoped）。?status= ?assetId= ?mine=1
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const sp = request.nextUrl.searchParams;
  const sw = siteWhere(g.ctx.access);

  // 透過 asset 關聯做 site 範圍過濾
  const where: Record<string, unknown> = {};
  if (sw.siteId) where.asset = { siteId: sw.siteId };
  if (sp.get('status')) where.reviewStatus = sp.get('status');
  const assetId = parsePositiveInt(sp.get('assetId'));
  if (sp.get('assetId') && !assetId) return ok([]);
  if (assetId) where.assetId = assetId;
  if (sp.get('mine') === '1') where.requesterUserId = g.ctx.user.userId;

  const rows = await prisma.assetModificationRequest.findMany({
    where,
    include: { asset: { select: { assetCode: true, name: true, siteId: true } } },
    orderBy: { requestedAt: 'desc' },
    take: 300,
  });
  return ok(
    rows.map((r) => ({
      ...r,
      fieldLabel: PROPERTY_FIELD_LABEL[r.field as PropertyEditableField] ?? r.field,
    }))
  );
}

// POST：建立修改申請（自動帶入原始值）
export async function POST(request: NextRequest) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const body = await request.json().catch(() => null);
  const field = String(body?.field ?? '') as PropertyEditableField;
  const proposedValue = body?.proposedValue != null ? String(body.proposedValue) : '';
  if (!PROPERTY_EDITABLE_FIELDS.includes(field)) return fail('參數錯誤：field');
  if (!proposedValue.trim()) return fail('請填寫建議修改值');
  if (field === 'maintenanceFrequency' && normalizeFrequencyDays(proposedValue) === null) {
    return fail('無法識別應維護頻率，請使用系統支援的頻率');
  }
  if (field === 'nextMaintenanceDate' && Number.isNaN(new Date(proposedValue).getTime())) {
    return fail('建議日期格式錯誤');
  }

  const requestedSiteId = body?.siteId != null ? parsePositiveInt(body.siteId) : null;
  if (body?.siteId != null && !requestedSiteId) return fail('參數錯誤：siteId');
  if (requestedSiteId != null && !canMaintainSite(g.ctx.access, requestedSiteId)) return fail('僅維護人員可建立修改申請', 403);

  let asset = null;
  const assetIdInput = parsePositiveInt(body?.assetId);
  const maintainableWhere = maintainableSiteWhere(g.ctx.access);
  if (assetIdInput) {
    asset = await prisma.propertyAsset.findFirst({
      where: { ...maintainableWhere, id: assetIdInput, isActive: true },
    });
  } else if (body?.assetCode) {
    const matches = await prisma.propertyAsset.findMany({
      where: {
        ...maintainableWhere,
        ...(requestedSiteId != null ? { siteId: requestedSiteId } : {}),
        assetCode: String(body.assetCode).trim(),
        isActive: true,
      },
      orderBy: { siteId: 'asc' },
      take: 2,
    });
    if (matches.length > 1) return fail('財產編號存在於多個據點，請指定 siteId 或改用資產明細送出申請', 409);
    asset = matches[0] ?? null;
  }
  if (!asset) return fail('找不到資產（請確認財產編號）', 404);
  if (!canMaintainSite(g.ctx.access, asset.siteId)) return fail('僅維護人員可建立修改申請', 403);

  const me = await prisma.employee.findUnique({
    where: { id: g.ctx.user.employeeId },
    select: { name: true },
  });
  const originalValue =
    field === 'nextMaintenanceDate'
      ? asset.nextMaintenanceDate
        ? asset.nextMaintenanceDate.toISOString().slice(0, 10)
        : ''
      : ((asset[field as keyof typeof asset] as string | null) ?? '');

  const created = await prisma.assetModificationRequest.create({
    data: {
      requestCode: `MR-${Date.now()}-${asset.assetCode}`,
      assetId: asset.id,
      assetCode: asset.assetCode,
      field,
      originalValue: String(originalValue),
      proposedValue,
      reason: body?.reason ?? null,
      requesterUserId: g.ctx.user.userId,
      requesterName: me?.name ?? g.ctx.user.username,
    },
  });
  return ok(created, '已送出修改申請');
}
