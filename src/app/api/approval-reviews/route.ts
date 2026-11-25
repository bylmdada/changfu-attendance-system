import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { isReviewerFor } from '@/lib/approval-service';
import { getApprovalWorkflow } from '@/lib/approval-workflow';
import { buildResignationHistoryFromRecord } from '@/lib/resignation-approval-history';

/**
 * 改版前核准／駁回的離職單沒有流程實例，歷程用離職單自己保存的決定、審核人與時間還原。
 * 回傳 null 代表沒有可還原的決定（單不存在或仍待審），由呼叫端走原本的「待審」回應。
 */
async function getResignationHistoryFromRecord(
  user: { role: string; employeeId: number },
  recordId: number,
  department: string | null
) {
  if (!Number.isInteger(recordId) || recordId <= 0) return null;

  const record = await prisma.resignationRecord.findUnique({
    where: { id: recordId },
    select: {
      employeeId: true,
      status: true,
      approvedById: true,
      approvedAt: true,
      rejectionReason: true,
      notes: true,
      employee: { select: { department: true } }
    }
  });
  if (!record?.approvedAt) return null;

  // 有實際決定內容時，只有人資／管理員與申請人本人看得到
  const isPrivilegedRole = user.role === 'ADMIN' || user.role === 'HR';
  if (!isPrivilegedRole && record.employeeId !== user.employeeId) {
    return NextResponse.json({ error: '無權查看此審核歷程' }, { status: 403 });
  }

  // approvedById 存的是審核者的帳號（User）ID
  const reviewerAccount = record.approvedById
    ? await prisma.user.findUnique({
        where: { id: record.approvedById },
        select: { username: true, role: true, employee: { select: { name: true } } }
      })
    : null;
  const workflow = await getApprovalWorkflow('RESIGNATION', {
    department: record.employee?.department ?? department
  });

  const history = buildResignationHistoryFromRecord(
    record,
    {
      name: reviewerAccount?.employee?.name || reviewerAccount?.username || '管理員',
      role: reviewerAccount?.role || 'ADMIN'
    },
    workflow?.approvalLevel ?? 2
  );

  return history ? NextResponse.json({ success: true, ...history }) : null;
}

/**
 * 取得特定申請單的審核歷程 API
 * GET /api/approval-reviews?requestType=LEAVE&requestId=1
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestType = searchParams.get('requestType');
    const requestId = searchParams.get('requestId');
    const department = searchParams.get('department');

    if (!requestType || !requestId) {
      return NextResponse.json({ error: '缺少 requestType 或 requestId' }, { status: 400 });
    }

    // 查詢審核實例
    const instance = await prisma.approvalInstance.findFirst({
      where: {
        requestType,
        requestId: parseInt(requestId)
      },
      include: {
        reviews: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!instance) {
      if (requestType === 'RESIGNATION') {
        const fromRecord = await getResignationHistoryFromRecord(user, parseInt(requestId), department);
        if (fromRecord) return fromRecord;
      }

      const workflow = await getApprovalWorkflow(requestType, { department });

      return NextResponse.json({
        success: true,
        currentLevel: 1,
        maxLevel: workflow?.approvalLevel ?? 2,
        status: 'PENDING',
        reviews: []
      });
    }

    const isPrivilegedRole = user.role === 'ADMIN' || user.role === 'HR';
    const isApplicant = user.employeeId === instance.applicantId;
    let canView = isPrivilegedRole || isApplicant;

    if (!canView && instance.department) {
      const reviewerPermission = await isReviewerFor(user.employeeId, instance.department, instance.requestType);
      canView = reviewerPermission.isReviewer;
    }

    if (!canView) {
      return NextResponse.json({ error: '無權查看此審核歷程' }, { status: 403 });
    }

    // 格式化審核記錄
    const reviews = instance.reviews.map(r => ({
      level: r.level,
      reviewerName: r.reviewerName,
      reviewerRole: r.reviewerRole,
      status: r.action === 'APPROVE' ? 'APPROVED' : 
              r.action === 'REJECT' ? 'REJECTED' : 
              r.action === 'DISAGREE' ? 'DISAGREED' : 'PENDING',
      comment: r.comment,
      reviewedAt: r.createdAt.toISOString()
    }));

    return NextResponse.json({
      success: true,
      currentLevel: instance.currentLevel,
      maxLevel: instance.maxLevel,
      status: instance.status,
      reviews
    });
  } catch (error) {
    console.error('取得審核歷程失敗:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}
