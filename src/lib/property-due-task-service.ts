import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/database';
import {
  addDays,
  buildRecordId,
  startOfDay,
} from '@/lib/property-maintenance-utils';

type DueAsset = {
  id: number;
  siteId: number;
  assetCode: string;
  maintenanceFrequency: string | null;
  frequencyDays: number | null;
  nextMaintenanceDate: Date | null;
  managerName: string | null;
};

function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
}

export function getImmediateMaintenanceDueDate(
  asset: Pick<DueAsset, 'frequencyDays' | 'nextMaintenanceDate'>,
  now: Date = new Date()
): Date | null {
  if (!asset.frequencyDays || asset.frequencyDays <= 0) return null;
  const today = startOfDay(now);
  if (!asset.nextMaintenanceDate) return today;

  const nextMaintenanceDate = startOfDay(asset.nextMaintenanceDate);
  if (nextMaintenanceDate.getTime() <= today.getTime()) return nextMaintenanceDate;
  return null;
}

export async function ensureImmediateMaintenanceTasks({
  now = new Date(),
  where = {},
}: {
  now?: Date;
  where?: Prisma.PropertyAssetWhereInput;
} = {}) {
  const assets = await prisma.propertyAsset.findMany({
    where: {
      ...where,
      isActive: true,
      frequencyDays: { not: null },
    },
    select: {
      id: true,
      siteId: true,
      assetCode: true,
      maintenanceFrequency: true,
      frequencyDays: true,
      nextMaintenanceDate: true,
      managerName: true,
    },
  });

  let created = 0;
  let skipped = 0;
  for (const asset of assets) {
    const dueDate = getImmediateMaintenanceDueDate(asset, now);
    if (!dueDate || !asset.frequencyDays) {
      skipped++;
      continue;
    }

    try {
      const taskCreated = await prisma.$transaction(async (tx) => {
        const openTask = await tx.maintenanceRecord.findFirst({
          where: { assetId: asset.id, status: 'PENDING' },
          select: { id: true },
        });
        if (openTask) return false;

        const advanced = await tx.propertyAsset.updateMany({
          where: {
            id: asset.id,
            isActive: true,
            nextMaintenanceDate: asset.nextMaintenanceDate,
          },
          data: { nextMaintenanceDate: addDays(dueDate, asset.frequencyDays!) },
        });
        if (advanced.count === 0) return false;

        await tx.maintenanceRecord.create({
          data: {
            recordId: buildRecordId(asset.assetCode, dueDate),
            siteId: asset.siteId,
            assetId: asset.id,
            assetCode: asset.assetCode,
            maintenanceCycle: asset.maintenanceFrequency,
            dueDate,
            status: 'PENDING',
            auditStatus: 'PENDING',
            maintainerRaw: asset.managerName,
            generatedByCron: true,
            note: `系統即時產生待維護任務（頻率：${asset.maintenanceFrequency ?? ''}）`,
          },
        });
        return true;
      });

      if (taskCreated) created++;
      else skipped++;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      skipped++;
    }
  }

  return { created, skipped };
}
