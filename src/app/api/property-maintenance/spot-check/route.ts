import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canManageSite } from '@/lib/property-access';
import { buildEvidenceSingle } from '@/lib/property-report-service';
import { parseBoundedPositiveInt, parsePositiveInt } from '@/lib/property-query';

/**
 * POST { siteId, count?=3 }：每月抽查（§24）。
 * 隨機抽 N 筆資產，確認佐證報表可持續產生，並寫入 AuditLog 供評鑑查核。
 */
export async function POST(request: NextRequest) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const body = await request.json().catch(() => null);
  const siteId = parsePositiveInt(body?.siteId);
  const count = parseBoundedPositiveInt(body?.count, 3, 10);
  if (!siteId) return fail('參數錯誤：siteId');
  if (!canManageSite(g.ctx.access, siteId)) return fail('需管理權限', 403);

  const assets = await prisma.propertyAsset.findMany({
    where: { siteId, isActive: true },
    select: { id: true, assetCode: true, name: true },
  });
  if (assets.length === 0) return fail('該據點無資產可抽查', 400);

  // 隨機抽 N 筆
  const picked = [...assets].sort(() => Math.random() - 0.5).slice(0, count);
  const results: { assetCode: string; name: string; ok: boolean; records: number; error?: string }[] =
    [];
  for (const a of picked) {
    try {
      const ev = await buildEvidenceSingle(siteId, a.assetCode);
      results.push({
        assetCode: a.assetCode,
        name: a.name,
        ok: !!ev && ev.buffer.length > 0,
        records: ev?.count ?? 0,
      });
    } catch (e) {
      results.push({
        assetCode: a.assetCode,
        name: a.name,
        ok: false,
        records: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const allOk = results.every((r) => r.ok);

  await prisma.auditLog.create({
    data: {
      userId: g.ctx.user.userId,
      employeeId: g.ctx.user.employeeId,
      action: 'PROPERTY_SPOT_CHECK',
      targetType: 'PropertySite',
      targetId: siteId,
      description: `財產佐證每月抽查 ${picked.length} 筆：${results
        .map((r) => `${r.assetCode}(${r.ok ? 'OK' : 'FAIL'})`)
        .join('、')}`,
      success: allOk,
      riskLevel: allOk ? 'LOW' : 'MEDIUM',
    },
  });

  return ok({ allOk, results }, allOk ? '抽查通過：佐證報表均可產生' : '抽查發現問題，請檢視');
}

// GET：近期抽查紀錄（讀 AuditLog）
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  if (!g.ctx.access.isGlobalAdmin && g.ctx.access.supervisorSiteIds.length === 0) {
    return fail('需主管或稽核權限', 403);
  }
  const logs = await prisma.auditLog.findMany({
    where: {
      action: 'PROPERTY_SPOT_CHECK',
      ...(g.ctx.access.isGlobalAdmin ? {} : { targetId: { in: g.ctx.access.supervisorSiteIds } }),
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, description: true, success: true, createdAt: true, targetId: true },
  });
  return ok(logs);
}
