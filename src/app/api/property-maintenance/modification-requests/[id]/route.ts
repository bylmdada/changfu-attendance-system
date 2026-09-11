import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canManageSite } from '@/lib/property-access';
import { normalizeFrequencyDays } from '@/lib/property-maintenance-utils';
import { parsePositiveInt } from '@/lib/property-query';
import { PROPERTY_EDITABLE_FIELDS } from '@/lib/property-modification-fields';
import { normalizePropertyAttachmentPath } from '@/lib/property-attachment-paths';

const ASSET_CHANGED = 'ASSET_CHANGED';

/**
 * PUT：審核修改申請（§18）。body.decision = 'APPROVE' | 'REJECT'。
 * 核准 → 套用變更至財產主檔（頻率會重算 frequencyDays、日期會轉 Date）。
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const { id } = await params;
  const reqId = parsePositiveInt(id);
  if (!reqId) return fail('參數錯誤');

  const mr = await prisma.assetModificationRequest.findUnique({
    where: { id: reqId },
    include: { asset: true },
  });
  if (!mr) return fail('找不到申請', 404);
  if (!canManageSite(g.ctx.access, mr.asset.siteId)) return fail('需管理權限', 403);
  if (mr.reviewStatus !== 'PENDING') return fail('此申請已處理', 409);

  const body = await request.json().catch(() => null);
  const decision = String(body?.decision ?? '').toUpperCase();
  if (!['APPROVE', 'REJECT'].includes(decision)) return fail('decision 必須為 APPROVE 或 REJECT');

  if (decision === 'APPROVE') {
    const field = mr.field;
    if (!PROPERTY_EDITABLE_FIELDS.includes(field as (typeof PROPERTY_EDITABLE_FIELDS)[number])) {
      return fail('欄位不可套用', 400);
    }
    const data: Record<string, unknown> = {};
    if (field === 'maintenanceFrequency') {
      const frequencyDays = normalizeFrequencyDays(mr.proposedValue);
      if (frequencyDays === null) return fail('無法識別應維護頻率，請重新提出申請');
      data.maintenanceFrequency = mr.proposedValue;
      data.frequencyDays = frequencyDays;
    } else if (field === 'nextMaintenanceDate') {
      const dt = new Date(mr.proposedValue ?? '');
      if (isNaN(dt.getTime())) return fail('建議日期格式錯誤');
      data.nextMaintenanceDate = dt;
    } else if (field === 'photoPath') {
      const photoPath = normalizePropertyAttachmentPath(mr.proposedValue);
      if (!photoPath) return fail('財產照片路徑無效');
      data.photoPath = photoPath;
    } else {
      data[field] = mr.proposedValue;
    }

    const currentValue = field === 'nextMaintenanceDate'
      ? mr.asset.nextMaintenanceDate?.toISOString().slice(0, 10) ?? ''
      : String(mr.asset[field as keyof typeof mr.asset] ?? '');
    if (currentValue !== (mr.originalValue ?? '')) {
      return fail('財產資料已在申請後變更，請重新提出修改申請', 409);
    }

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.propertyAsset.updateMany({
          where: { id: mr.assetId, updatedAt: mr.asset.updatedAt },
          data,
        });
        if (updated.count === 0) throw new Error(ASSET_CHANGED);

        await tx.assetModificationRequest.update({
          where: { id: reqId },
          data: {
            reviewStatus: 'APPROVED',
            reviewerUserId: g.ctx.user.userId,
            reviewNote: body?.reviewNote ?? null,
          },
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === ASSET_CHANGED) {
        return fail('財產資料已在審核時變更，請重新提出修改申請', 409);
      }
      throw error;
    }
    return ok(null, '已核准並套用變更');
  }

  await prisma.assetModificationRequest.update({
    where: { id: reqId },
    data: {
      reviewStatus: 'REJECTED',
      reviewerUserId: g.ctx.user.userId,
      reviewNote: body?.reviewNote ?? null,
    },
  });
  return ok(null, '已退回申請');
}
