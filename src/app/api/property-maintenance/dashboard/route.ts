import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok } from '@/lib/property-api';
import { siteWhere } from '@/lib/property-access';
import {
  startOfDay,
  addDays,
  deriveDisplayStatus,
  displayStatusSortWeight,
  type MaintenanceStatus,
} from '@/lib/property-maintenance-utils';
import { ensureImmediateMaintenanceTasks } from '@/lib/property-due-task-service';

/** GET：財產管理首頁摘要（§6/§12）。逾期/今日/本週完成 + 排序任務清單。 */
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const sw = siteWhere(g.ctx.access);
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const weekAgo = addDays(today, -7);

  await ensureImmediateMaintenanceTasks({ now, where: sw });

  const [overdue, todayCount, weekDone] = await Promise.all([
    prisma.maintenanceRecord.count({
      where: { ...sw, status: 'PENDING', dueDate: { lt: today } },
    }),
    prisma.maintenanceRecord.count({
      where: { ...sw, status: 'PENDING', dueDate: { gte: today, lt: tomorrow } },
    }),
    prisma.maintenanceRecord.count({
      where: { ...sw, status: 'DONE', completedDate: { gte: weekAgo } },
    }),
  ]);

  // 待辦任務（逾期 + 今日，逾期優先），上限 100
  const pending = await prisma.maintenanceRecord.findMany({
    where: { ...sw, status: 'PENDING', dueDate: { lt: tomorrow } },
    include: { asset: { select: { name: true, location: true } }, site: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
    take: 100,
  });
  const tasks = pending
    .map((r) => ({
      recordId: r.recordId,
      assetCode: r.assetCode,
      assetName: r.asset?.name ?? '',
      location: r.asset?.location ?? '',
      siteName: r.site?.name ?? '',
      dueDate: r.dueDate,
      maintainerRaw: r.maintainerRaw,
      displayStatus: deriveDisplayStatus(r.status as MaintenanceStatus, r.dueDate, now),
    }))
    .sort(
      (a, b) =>
        displayStatusSortWeight(a.displayStatus) - displayStatusSortWeight(b.displayStatus)
    );

  return ok({
    summary: { overdue, today: todayCount, weekDone },
    tasks,
  });
}
