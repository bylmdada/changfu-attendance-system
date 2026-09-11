import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canAccessSite, canSuperviseSite, siteWhere } from '@/lib/property-access';
import {
  addDays,
  deriveDisplayStatus,
  displayStatusSortWeight,
  startOfDay,
  type DisplayStatus,
  type MaintenanceStatus,
} from '@/lib/property-maintenance-utils';
import { parseBoundedPositiveInt, parsePositiveInt } from '@/lib/property-query';
import { normalizePropertyAuditStatus } from '@/lib/property-audit-status';

const MAX_RECORD_PAGE = 1000000;

/**
 * GET：維護紀錄清單（site-scoped）。
 * ?status=PENDING|DONE|ABNORMAL ?display=OVERDUE|TODAY ?assetId= ?mine=1
 * ?audit=PENDING|APPROVED|REJECTED ?siteId= ?page ?pageSize
 */
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const sp = request.nextUrl.searchParams;
  const page = parseBoundedPositiveInt(sp.get('page'), 1, MAX_RECORD_PAGE);
  const pageSize = parseBoundedPositiveInt(sp.get('pageSize'), 100, 300);

  const where: Record<string, unknown> = { ...siteWhere(g.ctx.access) };
  const status = sp.get('status');
  if (status) {
    const normalizedStatus = status.toUpperCase();
    if (!['PENDING', 'DONE', 'ABNORMAL'].includes(normalizedStatus)) {
      return fail('status 參數錯誤');
    }
    where.status = normalizedStatus;
  }
  const siteIdParam = sp.get('siteId');
  if (siteIdParam) {
    const siteId = parsePositiveInt(siteIdParam);
    if (!siteId) return ok({ total: 0, page, pageSize, items: [] });
    if (!canAccessSite(g.ctx.access, siteId)) return ok({ total: 0, page, pageSize, items: [] });
    where.siteId = siteId;
  }
  const assetIdParam = sp.get('assetId');
  if (assetIdParam) {
    const assetId = parsePositiveInt(assetIdParam);
    if (!assetId) return ok({ total: 0, page, pageSize, items: [] });
    where.assetId = assetId;
  }
  const audit = sp.get('audit');
  if (audit) {
    const normalizedAudit = normalizePropertyAuditStatus(audit);
    if (!normalizedAudit) return fail('audit 參數錯誤');
    where.auditStatus = normalizedAudit;
    const requestedSiteId = typeof where.siteId === 'number' ? where.siteId : null;
    if (requestedSiteId) {
      if (!canSuperviseSite(g.ctx.access, requestedSiteId)) {
        return ok({ total: 0, page, pageSize, items: [] });
      }
    } else if (!g.ctx.access.isGlobalAdmin) {
      if (g.ctx.access.supervisorSiteIds.length === 0) {
        return ok({ total: 0, page, pageSize, items: [] });
      }
      where.siteId = { in: g.ctx.access.supervisorSiteIds };
    }
  }
  if (sp.get('mine') === '1') where.maintainerEmployeeId = g.ctx.user.employeeId;

  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const display = sp.get('display')?.toUpperCase() as DisplayStatus | undefined;
  if (display) {
    if (!['OVERDUE', 'TODAY', 'PENDING', 'DONE', 'ABNORMAL'].includes(display)) {
      return fail('display 參數錯誤');
    }
    if (display === 'DONE' || display === 'ABNORMAL') {
      where.status = display;
    } else {
      where.status = 'PENDING';
      if (display === 'OVERDUE') {
        where.dueDate = { lt: today };
      } else if (display === 'TODAY') {
        where.dueDate = { gte: today, lt: tomorrow };
      } else {
        where.OR = [{ dueDate: null }, { dueDate: { gte: tomorrow } }];
      }
    }
  }

  const [total, rows] = await Promise.all([
    prisma.maintenanceRecord.count({ where }),
    prisma.maintenanceRecord.findMany({
      where,
      include: { asset: { select: { name: true, location: true } }, site: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = rows.map((r) => ({
    ...r,
    displayStatus: deriveDisplayStatus(r.status as MaintenanceStatus, r.dueDate, now),
  }));

  // 首頁排序：逾期→今日→待執行→已完成
  items.sort(
    (a, b) => displayStatusSortWeight(a.displayStatus) - displayStatusSortWeight(b.displayStatus)
  );

  return ok({ total, page, pageSize, items });
}
