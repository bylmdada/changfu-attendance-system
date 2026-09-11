import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canAccessSite, canMaintainSite, canManageSite } from '@/lib/property-access';
import {
  normalizeFrequencyDays,
  deriveDisplayStatus,
  type MaintenanceStatus,
} from '@/lib/property-maintenance-utils';
import { parsePositiveInt } from '@/lib/property-query';
import { normalizePropertyAttachmentPath } from '@/lib/property-attachment-paths';

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

async function loadAsset(id: number) {
  return prisma.propertyAsset.findUnique({
    where: { id },
    include: { site: { select: { id: true, name: true } } },
  });
}

// GET：資產詳情 + 維護歷程（§24）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const { id } = await params;
  const assetId = parsePositiveInt(id);
  if (!assetId) return fail('資產 ID 錯誤');
  const asset = await loadAsset(assetId);
  if (!asset) return fail('找不到資產', 404);
  if (!canAccessSite(g.ctx.access, asset.siteId)) return fail('無權限', 403);

  const records = await prisma.maintenanceRecord.findMany({
    where: { assetId: asset.id },
    orderBy: [{ dueDate: 'desc' }, { recordId: 'desc' }],
  });
  const history = records.map((r) => ({
    ...r,
    displayStatus: deriveDisplayStatus(r.status as MaintenanceStatus, r.dueDate),
  }));
  return ok({ asset, history });
}

// PUT：編輯資產
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const { id } = await params;
  const assetId = parsePositiveInt(id);
  if (!assetId) return fail('資產 ID 錯誤');
  const asset = await loadAsset(assetId);
  if (!asset) return fail('找不到資產', 404);
  if (!canMaintainSite(g.ctx.access, asset.siteId)) return fail('僅維護人員可編輯財產資料', 403);

  const body = await request.json().catch(() => null);
  if (!body) return fail('缺少資料');
  let name: string | undefined;
  if (body.name !== undefined) {
    const parsedName = stringField(body.name);
    if (!parsedName) return fail('財產名稱不可空白');
    name = parsedName;
  }
  const freq = body.maintenanceFrequency === undefined
    ? undefined
    : stringField(body.maintenanceFrequency);
  const photoPath =
    body.photoPath === undefined ? undefined : normalizePropertyAttachmentPath(body.photoPath);
  if (body.photoPath && !photoPath) return fail('財產照片路徑無效');
  const acquiredDate = body.acquiredDate === undefined ? undefined : dateField(body.acquiredDate);
  const nextMaintenanceDate =
    body.nextMaintenanceDate === undefined ? undefined : dateField(body.nextMaintenanceDate);
  if (body.acquiredDate && !acquiredDate) return fail('取得日期格式錯誤');
  if (body.nextMaintenanceDate && !nextMaintenanceDate) return fail('應維護日期格式錯誤');

  const updated = await prisma.propertyAsset.update({
    where: { id: asset.id },
    data: {
      name,
      location: body.location !== undefined ? stringField(body.location) : undefined,
      managerName: body.managerName !== undefined ? stringField(body.managerName) : undefined,
      maintenanceFrequency: freq,
      frequencyDays: freq !== undefined ? normalizeFrequencyDays(freq) : undefined,
      photoPath,
      acquiredDate,
      nextMaintenanceDate,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    },
  });
  return ok(updated, '已更新');
}

// DELETE：停用資產
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const { id } = await params;
  const assetId = parsePositiveInt(id);
  if (!assetId) return fail('資產 ID 錯誤');
  const asset = await loadAsset(assetId);
  if (!asset) return fail('找不到資產', 404);
  if (!canManageSite(g.ctx.access, asset.siteId)) return fail('無權限', 403);
  await prisma.propertyAsset.update({ where: { id: asset.id }, data: { isActive: false } });
  return ok(null, '已停用資產');
}
