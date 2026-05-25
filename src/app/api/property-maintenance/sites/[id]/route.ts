import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { parsePositiveInt } from '@/lib/property-query';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  if (!g.ctx.access.isGlobalAdmin) return fail('需要管理員權限', 403);

  const { id } = await params;
  const siteId = parsePositiveInt(id);
  if (!siteId) return fail('參數錯誤');
  const body = await request.json().catch(() => null);
  if (!body) return fail('缺少資料');

  try {
    const site = await prisma.propertySite.update({
      where: { id: siteId },
      data: {
        name: body.name ? String(body.name).trim() : undefined,
        code: body.code ? String(body.code).trim() : undefined,
        institutionTitle: body.institutionTitle ? String(body.institutionTitle).trim() : undefined,
        evidenceTitle: body.evidenceTitle ? String(body.evidenceTitle).trim() : undefined,
        settings: body.settings !== undefined ? JSON.stringify(body.settings) : undefined,
        isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      },
    });
    return ok(site, '已更新');
  } catch (e) {
    console.error('更新據點失敗:', e);
    return fail('系統錯誤', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  if (!g.ctx.access.isGlobalAdmin) return fail('需要管理員權限', 403);

  const { id } = await params;
  const siteId = parsePositiveInt(id);
  if (!siteId) return fail('參數錯誤');
  try {
    // 安全起見：停用而非實刪（避免級聯刪除歷史）
    await prisma.propertySite.update({ where: { id: siteId }, data: { isActive: false } });
    return ok(null, '已停用據點');
  } catch (e) {
    console.error('停用據點失敗:', e);
    return fail('系統錯誤', 500);
  }
}
