import { NextRequest } from 'next/server';
import type { MaintenanceRecord } from '@prisma/client';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canAccessSite, canMaintainSite } from '@/lib/property-access';
import {
  deriveDisplayStatus,
  normalizeStatus,
  type MaintenanceStatus,
} from '@/lib/property-maintenance-utils';
import { notifySupervisorsOfSubmission } from '@/lib/property-cron-service';
import { normalizePropertyAttachmentPath } from '@/lib/property-attachment-paths';
import {
  parseConditionAssessmentInput,
} from '@/lib/property-condition-assessment';

const RECORD_NOT_PENDING = 'RECORD_NOT_PENDING';

async function loadRecord(recordId: string) {
  return prisma.maintenanceRecord.findUnique({
    where: { recordId },
    include: {
      asset: { select: { id: true, name: true, location: true } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
  });
}

// GET：紀錄詳情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const { recordId } = await params;
  const rec = await loadRecord(decodeURIComponent(recordId));
  if (!rec) return fail('找不到紀錄', 404);
  if (!canAccessSite(g.ctx.access, rec.siteId)) return fail('無權限', 403);
  return ok({
    ...rec,
    displayStatus: deriveDisplayStatus(rec.status as MaintenanceStatus, rec.dueDate),
  });
}

// PUT：提交維護結果（§9）。完成後 → 已完成 + 待主管稽核，並通知主管（§14）。
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const { recordId } = await params;
  const rec = await loadRecord(decodeURIComponent(recordId));
  if (!rec) return fail('找不到紀錄', 404);
  if (!canMaintainSite(g.ctx.access, rec.siteId)) return fail('僅維護人員可提交維護紀錄', 403);
  if (rec.status !== 'PENDING') return fail('此任務已提交或完成，無法重複送出', 409);

  const body = await request.json().catch(() => null);
  if (!body) return fail('缺少資料');

  // 維護人員：自動帶入登入者姓名
  const me = await prisma.employee.findUnique({
    where: { id: g.ctx.user.employeeId },
    select: { id: true, name: true },
  });

  const conditionAssessment = body.conditionAssessment === undefined
    ? null
    : parseConditionAssessmentInput(body.conditionAssessment);
  if (conditionAssessment && !conditionAssessment.ok) return fail(conditionAssessment.error);

  const newStatus = conditionAssessment?.data.maintenanceStatus
    ?? normalizeStatus(body.status ?? '已完成'); // 預設完成；異常→ABNORMAL
  const now = new Date();
  const photoPath =
    body.photoPath === undefined ? rec.photoPath : normalizePropertyAttachmentPath(body.photoPath);
  const signaturePath =
    body.signaturePath === undefined
      ? rec.signaturePath
      : normalizePropertyAttachmentPath(body.signaturePath);
  if (body.photoPath && !photoPath) return fail('維護照片路徑無效');
  if (body.signaturePath && !signaturePath) return fail('維護人簽章路徑無效');

  let updated: MaintenanceRecord;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.maintenanceRecord.updateMany({
        where: { recordId: rec.recordId, status: 'PENDING' },
        data: {
          status: newStatus,
          rawStatus: body.status ?? '已完成',
          completedDate: now,
          maintainerRaw: body.maintainerName ?? me?.name ?? rec.maintainerRaw,
          maintainerEmployeeId: me?.id ?? rec.maintainerEmployeeId,
          inventoryResult: body.inventoryResult ?? null,
          assetCondition: conditionAssessment
            ? [
                ...conditionAssessment.data.normalConditionItems,
                ...conditionAssessment.data.abnormalConditionItems,
              ].join('、')
            : body.assetCondition ?? null,
          maintenanceItem: conditionAssessment ? '狀態評量' : body.maintenanceItem ?? null,
          otherNote: conditionAssessment ? conditionAssessment.data.abnormalDescription : body.otherNote ?? null,
          conditionAssessmentStatus: conditionAssessment?.data.conditionAssessmentStatus ?? null,
          normalConditionItems: conditionAssessment
            ? JSON.stringify(conditionAssessment.data.normalConditionItems)
            : null,
          abnormalConditionItems: conditionAssessment
            ? JSON.stringify(conditionAssessment.data.abnormalConditionItems)
            : null,
          abnormalDescription: conditionAssessment?.data.abnormalDescription ?? null,
          photoPath,
          signaturePath,
          note: body.note ?? rec.note,
          auditStatus: 'PENDING',
          rejectReason: null,
          supervisorName: null,
          supervisorAuditDate: null,
          supervisorSignaturePath: null,
        },
      });
      if (updateResult.count === 0) throw new Error(RECORD_NOT_PENDING);

      const maintenanceRecord = await tx.maintenanceRecord.findUniqueOrThrow({
        where: { recordId: rec.recordId },
      });

      await tx.auditApproval.create({
        data: {
          recordId: rec.recordId,
          assetCode: rec.assetCode,
          submittedAt: now,
          auditStatus: 'PENDING',
        },
      });

      return maintenanceRecord;
    });
  } catch (error) {
    if (error instanceof Error && error.message === RECORD_NOT_PENDING) {
      return fail('此任務已提交或完成，無法重複送出', 409);
    }
    throw error;
  }

  // §14：通知主管（不阻斷）
  void notifySupervisorsOfSubmission(rec.siteId, {
    recordId: rec.recordId,
    assetCode: rec.assetCode,
    assetName: rec.asset?.name,
    maintainerRaw: updated.maintainerRaw,
    submittedByEmployeeId: updated.maintainerEmployeeId,
  }).catch((error) => console.error('財產維護送審通知失敗:', error));

  return ok(updated, '已提交，待主管稽核');
}
