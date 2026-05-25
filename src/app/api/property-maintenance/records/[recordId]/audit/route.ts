import { NextRequest } from 'next/server';
import type { MaintenanceRecord } from '@prisma/client';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canSuperviseSite } from '@/lib/property-access';
import { normalizePropertyAttachmentPath } from '@/lib/property-attachment-paths';

const AUDIT_ALREADY_PROCESSED = 'AUDIT_ALREADY_PROCESSED';

/**
 * POST：主管稽核（§11）。body.decision = 'APPROVE' | 'REJECT'。
 * 退回需 body.rejectReason。記錄稽核人與時間。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const { recordId } = await params;
  const rec = await prisma.maintenanceRecord.findUnique({
    where: { recordId: decodeURIComponent(recordId) },
  });
  if (!rec) return fail('找不到紀錄', 404);
  if (!canSuperviseSite(g.ctx.access, rec.siteId)) return fail('僅主管可稽核', 403);
  if (rec.auditStatus !== '待主管稽核') return fail('此紀錄目前不在待稽核狀態', 409);
  if (rec.maintainerEmployeeId && rec.maintainerEmployeeId === g.ctx.user.employeeId) {
    return fail('送出財產掃碼維護者不可審核自己的紀錄，請由其他主管/稽核人員審核', 403);
  }

  const body = await request.json().catch(() => null);
  const decision = String(body?.decision ?? '').toUpperCase();
  if (!['APPROVE', 'REJECT'].includes(decision)) return fail('decision 必須為 APPROVE 或 REJECT');
  const rejectReason = String(body?.rejectReason ?? '').trim();
  if (decision === 'REJECT' && !rejectReason) return fail('退回需填寫不通過原因');

  const me = await prisma.employee.findUnique({
    where: { id: g.ctx.user.employeeId },
    select: { name: true },
  });
  const now = new Date();
  const auditStatus = decision === 'APPROVE' ? '已通過' : '退回補正';
  const supervisorSignaturePath =
    body?.signaturePath === undefined
      ? rec.supervisorSignaturePath
      : normalizePropertyAttachmentPath(body.signaturePath);
  if (body?.signaturePath && !supervisorSignaturePath) return fail('主管簽章路徑無效');

  const auditData = {
    auditStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    supervisorName: me?.name ?? g.ctx.user.username,
    supervisorUserId: g.ctx.user.userId,
    supervisorAuditDate: now,
    supervisorSignaturePath,
    note: body?.note ?? null,
  };
  let updated: MaintenanceRecord;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.maintenanceRecord.updateMany({
        where: {
          recordId: rec.recordId,
          auditStatus: '待主管稽核',
          ...(rec.maintainerEmployeeId
            ? { NOT: { maintainerEmployeeId: g.ctx.user.employeeId } }
            : {}),
        },
        data: {
          auditStatus,
          supervisorName: me?.name ?? g.ctx.user.username,
          supervisorAuditDate: now,
          rejectReason: decision === 'REJECT' ? rejectReason : null,
          completedDate: decision === 'REJECT' ? null : rec.completedDate,
          supervisorSignaturePath,
          // 退回 → 任務回到待執行供補正
          status: decision === 'REJECT' ? 'PENDING' : rec.status,
        },
      });
      if (updateResult.count === 0) throw new Error(AUDIT_ALREADY_PROCESSED);

      const maintenanceRecord = await tx.maintenanceRecord.findUniqueOrThrow({
        where: { recordId: rec.recordId },
      });

      const audit = await tx.auditApproval.findFirst({ where: { recordId: rec.recordId } });
      if (audit) {
        await tx.auditApproval.update({ where: { id: audit.id }, data: auditData });
      } else {
        await tx.auditApproval.create({
          data: { recordId: rec.recordId, assetCode: rec.assetCode, submittedAt: now, ...auditData },
        });
      }

      return maintenanceRecord;
    });
  } catch (error) {
    if (error instanceof Error && error.message === AUDIT_ALREADY_PROCESSED) {
      return fail('此紀錄已被其他主管稽核，請重新整理後確認最新狀態', 409);
    }
    throw error;
  }

  return ok(updated, decision === 'APPROVE' ? '已核准' : '已退回補正');
}
