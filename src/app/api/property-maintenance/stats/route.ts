import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok } from '@/lib/property-api';
import { canAccessSite, siteWhere } from '@/lib/property-access';
import {
  deriveDisplayStatus,
  monthRange,
  shiftYearMonth,
  taipeiYearMonth,
  type MaintenanceStatus,
} from '@/lib/property-maintenance-utils';
import { parseBoundedPositiveInt, parsePositiveInt } from '@/lib/property-query';

/**
 * GET：維護統計（§19）。?siteId ?months=6
 * 回傳完成率/逾期率/未完成率 + 近 N 月趨勢（應維護 vs 已完成）。
 */
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const sp = request.nextUrl.searchParams;
  const months = parseBoundedPositiveInt(sp.get('months'), 6, 24);
  const sw = siteWhere(g.ctx.access);
  const baseWhere: Record<string, unknown> = { ...sw };
  const siteIdParam = sp.get('siteId');
  if (siteIdParam) {
    const siteId = parsePositiveInt(siteIdParam);
    if (!siteId) return ok({ summary: emptySummary(), trend: [] });
    if (!canAccessSite(g.ctx.access, siteId)) return ok({ summary: emptySummary(), trend: [] });
    baseWhere.siteId = siteId;
  }

  const now = new Date();

  const [total, done, abnormal, pendingRecs] = await Promise.all([
    prisma.maintenanceRecord.count({ where: baseWhere }),
    prisma.maintenanceRecord.count({ where: { ...baseWhere, status: 'DONE' } }),
    prisma.maintenanceRecord.count({ where: { ...baseWhere, status: 'ABNORMAL' } }),
    prisma.maintenanceRecord.findMany({
      where: { ...baseWhere, status: 'PENDING' },
      select: { dueDate: true },
    }),
  ]);
  const pending = pendingRecs.length;
  const overdue = pendingRecs.filter(
    (r) => deriveDisplayStatus('PENDING' as MaintenanceStatus, r.dueDate, now) === 'OVERDUE'
  ).length;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  // 近 N 月趨勢
  const currentYearMonth = taipeiYearMonth(now);
  const trend = await Promise.all(
    Array.from({ length: months }, async (_, index) => {
      const i = months - 1 - index;
      const { year, month } = shiftYearMonth(currentYearMonth.year, currentYearMonth.month, -i);
      const { start, end } = monthRange(year, month);
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      const [dueC, doneC] = await Promise.all([
        prisma.maintenanceRecord.count({ where: { ...baseWhere, dueDate: { gte: start, lt: end } } }),
        prisma.maintenanceRecord.count({
          where: { ...baseWhere, status: 'DONE', completedDate: { gte: start, lt: end } },
        }),
      ]);
      return { ym, due: dueC, done: doneC };
    })
  );

  function emptySummary() {
    return {
      total: 0,
      done: 0,
      pending: 0,
      overdue: 0,
      abnormal: 0,
      completionRate: 0,
      overdueRate: 0,
      pendingRate: 0,
    };
  }

  return ok({
    summary: {
      total,
      done,
      pending,
      overdue,
      abnormal,
      completionRate: pct(done, total),
      overdueRate: pct(overdue, total),
      pendingRate: pct(pending, total),
    },
    trend,
  });
}
