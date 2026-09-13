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

function isConcurrentTaskError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error
    && (error.code === 'P2002' || error.code === 'P2025');
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
      records: { none: { status: 'PENDING' } },
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
      // One nested write keeps the date advance and task creation atomic without
      // holding an interactive SQLite transaction open across JS callbacks.
      await prisma.propertyAsset.update({
        where: {
          id: asset.id,
          isActive: true,
          nextMaintenanceDate: asset.nextMaintenanceDate,
          records: { none: { status: 'PENDING' } },
        },
        data: {
          nextMaintenanceDate: addDays(dueDate, asset.frequencyDays),
          records: {
            create: {
              recordId: buildRecordId(asset.assetCode, dueDate),
              siteId: asset.siteId,
              assetCode: asset.assetCode,
              maintenanceCycle: asset.maintenanceFrequency,
              dueDate,
              status: 'PENDING',
              auditStatus: 'PENDING',
              maintainerRaw: asset.managerName,
              generatedByCron: true,
              note: `系統即時產生待維護任務（頻率：${asset.maintenanceFrequency ?? ''}）`,
            },
          },
        },
        select: { id: true },
      });
      created++;
    } catch (error) {
      if (!isConcurrentTaskError(error)) throw error;
      skipped++;
    }
  }

  return { created, skipped };
}
