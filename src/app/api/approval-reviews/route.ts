import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { isReviewerFor } from '@/lib/approval-service';
import { getApprovalWorkflow } from '@/lib/approval-workflow';

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
      const workflow = await getApprovalWorkflow(requestType);

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
      const reviewerPermission = await isReviewerFor(user.employeeId, instance.department);
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
