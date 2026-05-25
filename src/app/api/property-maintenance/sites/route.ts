import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';

// GET：列出可存取據點
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const { access } = g.ctx;
  const manageOnly = request.nextUrl.searchParams.get('manage') === '1';
  const assignedSiteIds = manageOnly
    ? Array.from(access.roleBySite.entries())
        .filter(([, role]) => role === 'ADMIN')
        .map(([siteId]) => siteId)
    : access.siteIds;
  const sites = await prisma.propertySite.findMany({
    where: {
      isActive: true,
      ...(manageOnly && !access.isGlobalAdmin
        ? { id: { in: assignedSiteIds.length ? assignedSiteIds : [-1] } }
        : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      code: true,
      institutionTitle: true,
      evidenceTitle: true,
      settings: true,
      isActive: true,
      _count: { select: { assets: true } },
    },
  });
  return ok(sites);
}

// POST：新增據點（全域 ADMIN/HR）
export async function POST(request: NextRequest) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  if (!g.ctx.access.isGlobalAdmin) return fail('需要管理員權限', 403);

  const body = await request.json().catch(() => null);
  if (!body?.name || !body?.code || !body?.institutionTitle) {
    return fail('缺少必填欄位：name / code / institutionTitle');
  }
  try {
    const site = await prisma.propertySite.create({
      data: {
        name: String(body.name).trim(),
        code: String(body.code).trim(),
        institutionTitle: String(body.institutionTitle).trim(),
        evidenceTitle: body.evidenceTitle ? String(body.evidenceTitle).trim() : undefined,
        settings: body.settings ? JSON.stringify(body.settings) : null,
      },
    });
    return ok(site, '已新增據點');
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      return fail('據點名稱或代碼已存在', 409);
    }
    console.error('建立據點失敗:', e);
    return fail('系統錯誤', 500);
  }
}
