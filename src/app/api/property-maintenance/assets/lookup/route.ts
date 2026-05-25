import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canMaintainSite, siteWhere } from '@/lib/property-access';
import { deriveDisplayStatus, type MaintenanceStatus } from '@/lib/property-maintenance-utils';
import { ensureImmediateMaintenanceTasks } from '@/lib/property-due-task-service';

/**
 * GET ?code=：掃碼/手動輸入後查詢財產（§7）。
 * 回傳資產基本資料、目前是否需維護、下次維護日、可開始的待辦任務。
 */
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const code = request.nextUrl.searchParams.get('code')?.trim();
  if (!code) return fail('請提供財產編號');

  const asset = await prisma.propertyAsset.findFirst({
    where: { ...siteWhere(g.ctx.access), assetCode: code, isActive: true },
    include: { site: { select: { id: true, name: true } } },
  });
  if (!asset) return fail('查無此財產或無權限', 404);

  await ensureImmediateMaintenanceTasks({ where: { id: asset.id } });
  const currentAsset =
    (await prisma.propertyAsset.findUnique({
      where: { id: asset.id },
      include: { site: { select: { id: true, name: true } } },
    })) ?? asset;

  // 最近一筆待執行任務（可開始維護）
  const openTask = await prisma.maintenanceRecord.findFirst({
    where: { assetId: currentAsset.id, status: 'PENDING' },
    orderBy: { dueDate: 'asc' },
  });
  const lastDone = await prisma.maintenanceRecord.findFirst({
    where: { assetId: currentAsset.id, status: 'DONE' },
    orderBy: { completedDate: 'desc' },
    select: { completedDate: true },
  });

  const displayStatus = openTask
    ? deriveDisplayStatus(openTask.status as MaintenanceStatus, openTask.dueDate)
    : 'DONE';

  return ok({
    asset: {
      id: currentAsset.id,
      siteId: currentAsset.siteId,
      assetCode: currentAsset.assetCode,
      name: currentAsset.name,
      photoPath: currentAsset.photoPath,
      location: currentAsset.location,
      managerName: currentAsset.managerName,
      maintenanceFrequency: currentAsset.maintenanceFrequency,
      acquiredDate: currentAsset.acquiredDate,
      nextMaintenanceDate: currentAsset.nextMaintenanceDate,
      siteName: currentAsset.site.name,
    },
    needsMaintenance: !!openTask,
    canMaintain: canMaintainSite(g.ctx.access, currentAsset.siteId),
    displayStatus, // OVERDUE / TODAY / PENDING / DONE
    openTask: openTask
      ? { recordId: openTask.recordId, dueDate: openTask.dueDate, status: openTask.status }
      : null,
    lastCompletedDate: lastDone?.completedDate ?? null,
  });
}
