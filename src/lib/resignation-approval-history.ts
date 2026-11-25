import type { Prisma } from '@prisma/client';

type ApprovalHistoryClient = Pick<Prisma.TransactionClient, 'approvalInstance' | 'approvalReview'>;

export type ResignationDecision = 'APPROVE' | 'REJECT';

/**
 * 管理員／HR 直接核准或駁回離職單時，把決定寫進審核歷程（審核歷程 API 只讀流程實例）。
 * 要在改離職單狀態的同一個交易內呼叫，兩邊才會一起成功或一起失敗。
 * 離職單有既有流程實例就沿用（比照眷屬申請的核准路徑）；沒有就建立一筆已結案的實例，
 * 決定記在最後一階（直接決核＝管理員這一階，主管那一階沒有審核紀錄）。
 */
export async function recordResignationDecision(
  tx: ApprovalHistoryClient,
  params: {
    recordId: number;
    applicant: { id: number; name: string; department: string | null };
    reviewer: { employeeId: number; name: string; role: string };
    action: ResignationDecision;
    comment: string | null;
    workflow: { approvalLevel: number; requireManager: boolean };
  }
) {
  const finalStatus = params.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const existing = await tx.approvalInstance.findFirst({
    where: { requestType: 'RESIGNATION', requestId: params.recordId },
  });

  if (existing) {
    await tx.approvalReview.create({
      data: {
        instanceId: existing.id,
        level: existing.currentLevel,
        reviewerId: params.reviewer.employeeId,
        reviewerName: params.reviewer.name,
        reviewerRole: params.reviewer.role,
        action: params.action,
        comment: params.comment,
      },
    });

    const updated = await tx.approvalInstance.updateMany({
      where: { id: existing.id, currentLevel: existing.currentLevel, status: existing.status },
      data: { status: finalStatus, currentLevel: existing.maxLevel },
    });
    if (updated.count !== 1) {
      throw new Error('審核流程狀態已變更，請重新整理後再試');
    }
    return;
  }

  const finalLevel = params.workflow.approvalLevel;
  const instance = await tx.approvalInstance.create({
    data: {
      requestType: 'RESIGNATION',
      requestId: params.recordId,
      applicantId: params.applicant.id,
      applicantName: params.applicant.name,
      department: params.applicant.department,
      currentLevel: finalLevel,
      maxLevel: finalLevel,
      requireManager: params.workflow.requireManager,
      status: finalStatus,
    },
  });

  await tx.approvalReview.create({
    data: {
      instanceId: instance.id,
      level: finalLevel,
      reviewerId: params.reviewer.employeeId,
      reviewerName: params.reviewer.name,
      reviewerRole: params.reviewer.role,
      action: params.action,
      comment: params.comment,
    },
  });
}

/**
 * 改版前核准／駁回的離職單沒有流程實例。離職單自己保存了決定（狀態）、審核人與時間，
 * 用它們還原一筆可查證的歷程；進入交接、完成離職後仍視為「已核准」。沒有決定時間就不還原。
 */
export function buildResignationHistoryFromRecord(
  record: { status: string; approvedAt: Date | null; rejectionReason: string | null; notes: string | null },
  reviewer: { name: string; role: string },
  maxLevel: number
) {
  if (!record.approvedAt) return null;

  const rejected = record.status === 'REJECTED';
  const approved = ['APPROVED', 'IN_HANDOVER', 'COMPLETED'].includes(record.status);
  if (!rejected && !approved) return null;

  const status = rejected ? ('REJECTED' as const) : ('APPROVED' as const);
  return {
    currentLevel: maxLevel,
    maxLevel,
    status,
    reviews: [
      {
        level: maxLevel,
        reviewerName: reviewer.name,
        reviewerRole: reviewer.role,
        status,
        comment: rejected ? record.rejectionReason : record.notes,
        reviewedAt: record.approvedAt.toISOString(),
      },
    ],
  };
}
