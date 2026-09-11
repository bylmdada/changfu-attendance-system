import { prisma } from '../src/lib/database';

const CONFIRMATION_TOKEN = 'REPAIR_ONE_LEVEL_LEAVE_APPROVAL_STATES';
const ACCOUNTING_LEAVE_TYPES = new Set(['ANNUAL', 'ANNUAL_LEAVE', 'COMPENSATORY']);

async function getRepairPlan() {
  const instances = await prisma.approvalInstance.findMany({
    where: {
      requestType: 'LEAVE',
      maxLevel: 1,
      currentLevel: { gt: 1 },
      status: 'LEVEL2_REVIEWING',
    },
    orderBy: { requestId: 'asc' },
  });
  const leaveRequests = await prisma.leaveRequest.findMany({
    where: {
      id: { in: instances.map((instance) => instance.requestId) },
      status: 'PENDING_ADMIN',
      managerOpinion: 'AGREE',
    },
    include: {
      employee: {
        select: { employeeId: true, name: true, department: true },
      },
    },
  });
  const instanceByRequestId = new Map(instances.map((instance) => [instance.requestId, instance]));
  const candidates = leaveRequests
    .filter((leaveRequest) => !ACCOUNTING_LEAVE_TYPES.has(leaveRequest.leaveType))
    .map((leaveRequest) => ({
      leaveRequest,
      instance: instanceByRequestId.get(leaveRequest.id),
    }));
  const accountingReviewRequired = leaveRequests.filter((leaveRequest) => (
    ACCOUNTING_LEAVE_TYPES.has(leaveRequest.leaveType)
  ));

  for (const candidate of candidates) {
    if (!candidate.instance) {
      throw new Error(`請假申請 #${candidate.leaveRequest.id} 找不到對應審核實例`);
    }
    if (!candidate.leaveRequest.managerReviewerId || !candidate.leaveRequest.managerReviewedAt) {
      throw new Error(`請假申請 #${candidate.leaveRequest.id} 缺少主管審核人或審核時間`);
    }
    const reviewCount = await prisma.approvalReview.count({
      where: { instanceId: candidate.instance.id, level: 1 },
    });
    if (reviewCount < 1) {
      throw new Error(`請假申請 #${candidate.leaveRequest.id} 缺少一階審核軌跡`);
    }
  }

  return { candidates, accountingReviewRequired };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('必須明確設定 DATABASE_URL，避免修復到錯誤資料庫');
  }

  const apply = process.argv.includes('--apply');
  const confirmation = process.argv
    .find((argument) => argument.startsWith('--confirm='))
    ?.split('=')
    .slice(1)
    .join('=');
  if (apply && confirmation !== CONFIRMATION_TOKEN) {
    throw new Error(`apply 模式必須加上 --confirm=${CONFIRMATION_TOKEN}`);
  }

  const { candidates, accountingReviewRequired } = await getRepairPlan();
  console.table(candidates.map(({ leaveRequest }) => ({
    requestId: leaveRequest.id,
    employeeId: leaveRequest.employee.employeeId,
    name: leaveRequest.employee.name,
    department: leaveRequest.employee.department,
    leaveType: leaveRequest.leaveType,
    managerReviewerId: leaveRequest.managerReviewerId,
  })));
  console.log(`可安全修復：${candidates.length} 筆`);
  console.log(`需另行核對餘額：${accountingReviewRequired.length} 筆（特休／補休未納入）`);

  if (!apply) {
    console.log(`dry-run 完成；確認後請加上 --apply --confirm=${CONFIRMATION_TOKEN}`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const { leaveRequest, instance } of candidates) {
      if (!instance || !leaveRequest.managerReviewerId || !leaveRequest.managerReviewedAt) {
        throw new Error(`請假申請 #${leaveRequest.id} 修復前置資料不完整`);
      }

      const instanceResult = await tx.approvalInstance.updateMany({
        where: {
          id: instance.id,
          maxLevel: 1,
          currentLevel: { gt: 1 },
          status: 'LEVEL2_REVIEWING',
        },
        data: { currentLevel: 1, status: 'APPROVED' },
      });
      if (instanceResult.count !== 1) {
        throw new Error(`請假申請 #${leaveRequest.id} 的審核實例已變更，停止修復`);
      }

      const leaveResult = await tx.leaveRequest.updateMany({
        where: {
          id: leaveRequest.id,
          status: 'PENDING_ADMIN',
          managerOpinion: 'AGREE',
          managerReviewerId: leaveRequest.managerReviewerId,
        },
        data: {
          status: 'APPROVED',
          approvedBy: leaveRequest.managerReviewerId,
          approvedAt: leaveRequest.managerReviewedAt,
        },
      });
      if (leaveResult.count !== 1) {
        throw new Error(`請假申請 #${leaveRequest.id} 狀態已變更，停止修復`);
      }
    }
  });

  const remaining = await getRepairPlan();
  if (remaining.candidates.length !== 0) {
    throw new Error(`修復後仍有 ${remaining.candidates.length} 筆可安全修復資料`);
  }
  console.log(`已完成 ${candidates.length} 筆一階請假狀態修復；特休／補休仍保留待核對。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
