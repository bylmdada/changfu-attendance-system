'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { toTaiwanDateStr } from '@/lib/timezone';
import { validateCSRF } from '@/lib/csrf';

/**
 * 勞退自提申請審核 API
 * - PUT: HR 審核 / Admin 決核
 * - DELETE: 員工取消待審核申請
 */

// PUT: 審核申請
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const applicationId = parseInt(id);

    if (isNaN(applicationId)) {
      return NextResponse.json({ error: '無效的申請 ID' }, { status: 400 });
    }

    const body = await request.json();
    const { action, opinion, note } = body;

    // 取得申請
    const application = await prisma.pensionContributionApplication.findUnique({
      where: { id: applicationId },
      include: {
        employee: { select: { id: true, name: true, laborPensionSelfRate: true } }
      }
    });

    if (!application) {
      return NextResponse.json({ error: '找不到申請' }, { status: 404 });
    }

    const isAdmin = user.role === 'ADMIN';
    const isHR = user.role === 'HR';

    // HR 審核邏輯
    if (isHR && application.status === 'PENDING_HR') {
      if (!['AGREE', 'DISAGREE'].includes(opinion)) {
        return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
      }

      // HR 審核後，無論同意或不同意都送管理員決核
      await prisma.pensionContributionApplication.update({
        where: { id: applicationId },
        data: {
          status: 'PENDING_ADMIN',
          hrReviewerId: user.employeeId,
          hrReviewedAt: new Date(),
          hrOpinion: opinion,
          hrNote: note || null
        }
      });

      return NextResponse.json({
        success: true,
        message: '已提交審核意見，待管理員決核'
      });
    }

    // Admin 可直接審核 PENDING_HR 狀態（跳過 HR）
    if (isAdmin && application.status === 'PENDING_HR') {
      if (!['APPROVE', 'REJECT'].includes(action)) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      const finalStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

      await prisma.$transaction(async (tx) => {
        await tx.pensionContributionApplication.update({
          where: { id: applicationId },
          data: {
            status: finalStatus,
            adminApproverId: user.employeeId,
            adminApprovedAt: new Date(),
            adminNote: note || null,
            // 標記跳過 HR 審核
            hrNote: '(管理員直接審核，跳過 HR 階段)'
          }
        });

        if (action === 'APPROVE') {
          await tx.employee.update({
            where: { id: application.employeeId },
            data: {
              laborPensionSelfRate: application.requestedRate
            }
          });
        }
      });

      return NextResponse.json({
        success: true,
        message: action === 'APPROVE' 
          ? `已直接核准，新比例 ${application.requestedRate}% 將於 ${toTaiwanDateStr(application.effectiveDate)} 生效`
          : '已直接駁回申請'
      });
    }

    // Admin 決核邏輯
    if (isAdmin && application.status === 'PENDING_ADMIN') {
      if (!['APPROVE', 'REJECT'].includes(action)) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      const finalStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

      await prisma.$transaction(async (tx) => {
        // 更新申請狀態
        await tx.pensionContributionApplication.update({
          where: { id: applicationId },
          data: {
            status: finalStatus,
            adminApproverId: user.employeeId,
            adminApprovedAt: new Date(),
            adminNote: note || null
          }
        });

        // 如果核准，更新員工的自提比例
        if (action === 'APPROVE') {
          await tx.employee.update({
            where: { id: application.employeeId },
            data: {
              laborPensionSelfRate: application.requestedRate
            }
          });
        }
      });

      return NextResponse.json({
        success: true,
        message: action === 'APPROVE' 
          ? `已核准，新比例 ${application.requestedRate}% 將於 ${toTaiwanDateStr(application.effectiveDate)} 生效`
          : '已駁回申請'
      });
    }

    return NextResponse.json({ error: '無權限執行此操作或狀態不符' }, { status: 403 });
  } catch (error) {
    console.error('審核勞退自提申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE: 取消申請（僅限申請人且狀態為待HR審核）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const applicationId = parseInt(id);

    if (isNaN(applicationId)) {
      return NextResponse.json({ error: '無效的申請 ID' }, { status: 400 });
    }

    const application = await prisma.pensionContributionApplication.findUnique({
      where: { id: applicationId }
    });

    if (!application) {
      return NextResponse.json({ error: '找不到申請' }, { status: 404 });
    }

    // 只有申請人可以取消，且只能在待 HR 審核時取消
    if (application.employeeId !== user.employeeId) {
      return NextResponse.json({ error: '只有申請人可以取消申請' }, { status: 403 });
    }

    if (application.status !== 'PENDING_HR') {
      return NextResponse.json({ error: '申請已進入審核流程，無法取消' }, { status: 400 });
    }

    await prisma.pensionContributionApplication.delete({
      where: { id: applicationId }
    });

    return NextResponse.json({
      success: true,
      message: '申請已取消'
    });
  } catch (error) {
    console.error('取消勞退自提申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// GET: 取得單一申請詳情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const applicationId = parseInt(id);

    if (isNaN(applicationId)) {
      return NextResponse.json({ error: '無效的申請 ID' }, { status: 400 });
    }

    const application = await prisma.pensionContributionApplication.findUnique({
      where: { id: applicationId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            insuredBase: true,
            baseSalary: true
          }
        },
        hrReviewer: { select: { id: true, name: true } },
        adminApprover: { select: { id: true, name: true } }
      }
    });

    if (!application) {
      return NextResponse.json({ error: '找不到申請' }, { status: 404 });
    }

    // 權限檢查：申請人、HR 或 Admin 可查看
    const isOwner = application.employeeId === user.employeeId;
    const isAdminOrHR = user.role === 'ADMIN' || user.role === 'HR';

    if (!isOwner && !isAdminOrHR) {
      return NextResponse.json({ error: '無權限查看' }, { status: 403 });
    }

    const insuredBase = application.employee.insuredBase || application.employee.baseSalary || 0;

    return NextResponse.json({
      success: true,
      application: {
        id: application.id,
        employee: application.employee,
        currentRate: application.currentRate,
        requestedRate: application.requestedRate,
        currentAmount: Math.round(insuredBase * application.currentRate / 100),
        requestedAmount: Math.round(insuredBase * application.requestedRate / 100),
        effectiveDate: toTaiwanDateStr(application.effectiveDate),
        reason: application.reason,
        status: application.status,
        hrReviewer: application.hrReviewer,
        hrOpinion: application.hrOpinion,
        hrNote: application.hrNote,
        hrReviewedAt: application.hrReviewedAt?.toISOString(),
        adminApprover: application.adminApprover,
        adminNote: application.adminNote,
        adminApprovedAt: application.adminApprovedAt?.toISOString(),
        createdAt: application.createdAt.toISOString()
      }
    });
  } catch (error) {
    console.error('取得勞退自提申請詳情失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
