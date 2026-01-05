/**
 * 審核實例 API
 * GET: 取得待審核項目 / 我的申請
 * POST: 執行審核
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { updateRequestStatus, WorkflowType } from '@/lib/approval-helper';
import { notifyApplicant, notifyReviewers } from '@/lib/approval-notifications';

// 申請類型名稱對照
const REQUEST_TYPE_NAMES: Record<string, string> = {
  SHIFT_CHANGE: '調班申請',
  SHIFT_SWAP: '換班申請',
  MISSED_CLOCK: '補打卡申請',
  LEAVE: '請假申請',
  OVERTIME: '加班申請',
  PURCHASE: '請購申請',
  RESIGNATION: '離職申請',
  PAYROLL_DISPUTE: '薪資異議',
  DEPENDENT_APP: '眷屬申請',
  ANNOUNCEMENT: '公告發布',
  PENSION_CONTRIBUTION: '勞退自提變更'
};

// 狀態名稱對照
const STATUS_NAMES: Record<string, string> = {
  PENDING: '待審核',
  LEVEL1_REVIEWING: '主管審核中',
  LEVEL1_APPROVED: '主管已核准',
  LEVEL2_REVIEWING: 'HR會簽中',
  LEVEL2_APPROVED: 'HR已同意',
  LEVEL2_DISAGREED: 'HR不同意（進入決核）',
  LEVEL3_REVIEWING: '管理員決核中',
  APPROVED: '已核准',
  REJECTED: '已退回',
  // 勞退自提狀態
  PENDING_HR: '待 HR 審核',
  PENDING_ADMIN: '待管理員決核'
};

// GET: 取得待審核項目
export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'pending'; // pending | my

    if (type === 'my') {
      // 我的申請
      const instances = await prisma.approvalInstance.findMany({
        where: { applicantId: user.employeeId },
        include: {
          reviews: {
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return NextResponse.json({
        success: true,
        applications: instances.map(inst => ({
          id: inst.id,
          requestType: inst.requestType,
          requestTypeName: REQUEST_TYPE_NAMES[inst.requestType] || inst.requestType,
          requestId: inst.requestId,
          status: inst.status,
          statusName: STATUS_NAMES[inst.status] || inst.status,
          currentLevel: inst.currentLevel,
          maxLevel: inst.maxLevel,
          deadlineAt: inst.deadlineAt?.toISOString(),
          createdAt: inst.createdAt.toISOString(),
          reviews: inst.reviews.map(r => ({
            level: r.level,
            reviewerName: r.reviewerName,
            reviewerRole: r.reviewerRole,
            action: r.action,
            comment: r.comment,
            createdAt: r.createdAt.toISOString()
          }))
        }))
      });
    }

    // 待審核項目
    interface WhereCondition {
      status: { in: string[] };
      OR?: Array<{ currentLevel: number; requireManager?: boolean } | { currentLevel: number; department: string }>;
    }
    
    const where: WhereCondition = {
      status: { in: ['PENDING', 'LEVEL1_REVIEWING', 'LEVEL2_REVIEWING', 'LEVEL3_REVIEWING'] }
    };

    if (user.role === 'ADMIN') {
      // 管理員可看所有待審核項目（HR只是會簽，決核權在管理員）
      // 不設 OR 條件，讓管理員看到所有待審核項目
    } else if (user.role === 'HR') {
      // HR 看二階（會簽）+ 不需主管的一階項目
      where.OR = [
        { currentLevel: 2 },
        { currentLevel: 1, requireManager: false }
      ];
    } else {
      // 主管和代理人看自己部門的一階項目
      
      // 1. 查詢作為部門主管的部門
      const managedDepts = await prisma.departmentManager.findMany({
        where: { employeeId: user.employeeId, isActive: true },
        select: { department: true }
      });
      
      // 2. 查詢作為代理人的部門
      const deputyDepts = await prisma.managerDeputy.findMany({
        where: { 
          deputyEmployeeId: user.employeeId, 
          isActive: true,
          OR: [
            { startDate: null },
            { startDate: { lte: new Date() } }
          ]
        },
        include: {
          manager: {
            select: { department: true }
          }
        }
      });
      
      // 合併所有可審核的部門
      const allDepartments = new Set<string>();
      managedDepts.forEach(d => allDepartments.add(d.department));
      deputyDepts.forEach(d => {
        if (d.manager?.department) {
          allDepartments.add(d.manager.department);
        }
      });

      if (allDepartments.size === 0) {
        return NextResponse.json({ success: true, pending: [], stats: { total: 0, urgent: 0, overdue: 0 } });
      }

      where.OR = Array.from(allDepartments).map(dept => ({
        currentLevel: 1,
        department: dept
      }));
    }

    const instances = await prisma.approvalInstance.findMany({
      where,
      include: {
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            reviewer: {
              select: { employeeId: true, department: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    // 過濾掉當前用戶在當前階段已經審核過的項目
    const filteredInstances = instances.filter(inst => {
      // 檢查是否有當前用戶在當前階段的審核紀錄
      const hasReviewedAtCurrentLevel = inst.reviews.some(
        r => r.reviewerId === user.employeeId && r.level === inst.currentLevel
      );
      return !hasReviewedAtCurrentLevel;
    });

    const now = new Date();
    
    // 取得申請詳情的輔助函數
    const getRequestDetails = async (requestType: string, requestId: number) => {
      try {
        switch (requestType) {
          case 'LEAVE': {
            const leave = await prisma.leaveRequest.findUnique({
              where: { id: requestId },
              select: {
                leaveType: true,
                startDate: true,
                endDate: true,
                totalDays: true,
                reason: true
              }
            });
            if (leave) {
              const LEAVE_TYPES: Record<string, string> = {
                ANNUAL: '特休假', SICK: '病假', PERSONAL: '事假',
                MARRIAGE: '婚假', BEREAVEMENT: '喪假', MATERNITY: '產假',
                PATERNITY_CHECKUP: '陪產檢及陪產假', COMPENSATORY: '補休',
                PRENATAL_CHECKUP: '產檢假', OFFICIAL: '公假'
              };
              return {
                type: 'leave',
                leaveType: LEAVE_TYPES[leave.leaveType] || leave.leaveType,
                startDate: leave.startDate?.toISOString().split('T')[0],
                endDate: leave.endDate?.toISOString().split('T')[0],
                totalDays: leave.totalDays,
                reason: leave.reason
              };
            }
            break;
          }
          case 'OVERTIME': {
            const overtime = await prisma.overtimeRequest.findUnique({
              where: { id: requestId },
              select: {
                overtimeDate: true,
                startTime: true,
                endTime: true,
                totalHours: true,
                reason: true
              }
            });
            if (overtime) {
              return {
                type: 'overtime',
                date: overtime.overtimeDate?.toISOString().split('T')[0],
                startTime: overtime.startTime,
                endTime: overtime.endTime,
                hours: overtime.totalHours,
                reason: overtime.reason
              };
            }
            break;
          }
          case 'MISSED_CLOCK': {
            const missed = await prisma.missedClockRequest.findUnique({
              where: { id: requestId },
              select: {
                workDate: true,
                requestedTime: true,
                clockType: true,
                reason: true
              }
            });
            if (missed) {
              return {
                type: 'missed_clock',
                date: missed.workDate,
                time: missed.requestedTime,
                clockType: missed.clockType === 'CLOCK_IN' ? '上班' : '下班',
                reason: missed.reason
              };
            }
            break;
          }
          case 'ANNOUNCEMENT': {
            const announcement = await prisma.announcement.findUnique({
              where: { id: requestId },
              select: {
                title: true,
                content: true,
                priority: true,
                category: true
              }
            });
            if (announcement) {
              const PRIORITIES: Record<string, string> = {
                HIGH: '高', MEDIUM: '中', LOW: '低'
              };
              return {
                type: 'announcement',
                title: announcement.title,
                content: announcement.content?.substring(0, 200) + (announcement.content && announcement.content.length > 200 ? '...' : ''),
                priority: PRIORITIES[announcement.priority] || announcement.priority,
                category: announcement.category
              };
            }
            break;
          }
          default:
            return null;
        }
      } catch {
        return null;
      }
      return null;
    };

    // 批量取得申請詳情
    const pendingWithDetails = await Promise.all(
      filteredInstances.map(async (inst) => {
        const isOverdue = inst.deadlineAt && new Date(inst.deadlineAt) < now;
        const isUrgent = inst.deadlineAt && 
          new Date(inst.deadlineAt) < new Date(now.getTime() + 24 * 60 * 60 * 1000) &&
          !isOverdue;

        const requestDetails = await getRequestDetails(inst.requestType, inst.requestId);

        return {
          id: inst.id,
          requestType: inst.requestType,
          requestTypeName: REQUEST_TYPE_NAMES[inst.requestType] || inst.requestType,
          requestId: inst.requestId,
          applicantName: inst.applicantName,
          department: inst.department,
          status: inst.status,
          statusName: STATUS_NAMES[inst.status] || inst.status,
          currentLevel: inst.currentLevel,
          maxLevel: inst.maxLevel,
          deadlineAt: inst.deadlineAt?.toISOString(),
          isOverdue,
          isUrgent,
          createdAt: inst.createdAt.toISOString(),
          reviews: inst.reviews.map(r => {
            // 職位簡稱：與員工清單格式統一
            const roleShortLabels: Record<string, string> = {
              'MANAGER': '正',
              'DEPUTY': '副',
              'HR': 'HR',
              'ADMIN': '管理員'
            };
            return {
              level: r.level,
              reviewerName: r.reviewerName,
              reviewerDepartment: r.reviewer?.department || '',
              roleShortLabel: roleShortLabels[r.reviewerRole] || r.reviewerRole,
              action: r.action,
              comment: r.comment,
              createdAt: r.createdAt.toISOString()
            };
          }),
          requestDetails
        };
      })
    );

    // 額外取得勞退自提待審核項目
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pensionApplications: any[] = [];
    
    if (user.role === 'ADMIN' || user.role === 'HR') {
      const pensionStatusFilter = user.role === 'ADMIN' 
        ? ['PENDING_HR', 'PENDING_ADMIN'] 
        : ['PENDING_HR'];
      
      const pendingPensions = await prisma.pensionContributionApplication.findMany({
        where: {
          status: { in: pensionStatusFilter }
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              department: true,
              position: true
            }
          },
          hrReviewer: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'asc' }
      });

      pensionApplications = pendingPensions.map(app => ({
        id: app.id * -1, // 使用負數 ID 來區分勞退自提
        requestType: 'PENSION_CONTRIBUTION',
        requestTypeName: REQUEST_TYPE_NAMES['PENSION_CONTRIBUTION'],
        requestId: app.id,
        applicantName: app.employee.name,
        department: app.employee.department || '',
        status: app.status,
        statusName: STATUS_NAMES[app.status] || app.status,
        currentLevel: app.status === 'PENDING_HR' ? 1 : 2,
        maxLevel: 2,
        deadlineAt: undefined,
        isOverdue: false,
        isUrgent: false,
        createdAt: new Date(Number(app.createdAt)).toISOString(),
        reviews: app.hrReviewer ? [{
          level: 1,
          reviewerName: app.hrReviewer.name,
          reviewerDepartment: '',
          roleShortLabel: 'HR',
          action: app.hrOpinion === 'AGREE' ? 'APPROVE' : 'REJECT',
          comment: app.hrNote,
          createdAt: app.hrReviewedAt?.toISOString() || ''
        }] : [],
        requestDetails: {
          type: 'pension_contribution',
          currentRate: app.currentRate,
          requestedRate: app.requestedRate,
          effectiveDate: app.effectiveDate.toISOString().split('T')[0],
          reason: app.reason
        }
      }));
    }

    // 合併所有待審核項目
    const allPending = [...pendingWithDetails, ...pensionApplications];
    
    return NextResponse.json({
      success: true,
      pending: allPending,
      stats: {
        total: allPending.length,
        urgent: filteredInstances.filter(i => 
          i.deadlineAt && 
          new Date(i.deadlineAt) < new Date(now.getTime() + 24 * 60 * 60 * 1000) &&
          new Date(i.deadlineAt) >= now
        ).length,
        overdue: filteredInstances.filter(i => 
          i.deadlineAt && new Date(i.deadlineAt) < now
        ).length
      }
    });

  } catch (error) {
    console.error('取得審核項目失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST: 執行審核
export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const data = await request.json();
    const { instanceId, action, comment } = data;

    if (!instanceId || !action) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: '無效的審核動作' }, { status: 400 });
    }

    // 取得審核實例
    const instance = await prisma.approvalInstance.findUnique({
      where: { id: instanceId }
    });

    if (!instance) {
      return NextResponse.json({ error: '找不到審核項目' }, { status: 404 });
    }

    // 驗證權限
    let reviewerRole = 'ADMIN';
    if (instance.currentLevel === 1) {
      // 一階審核需要是部門主管
      if (user.role !== 'ADMIN') {
        const isManager = await prisma.departmentManager.findFirst({
          where: {
            employeeId: user.employeeId,
            department: instance.department || undefined,
            isActive: true
          }
        });
        if (!isManager) {
          return NextResponse.json({ error: '您不是此部門的審核者' }, { status: 403 });
        }
        reviewerRole = 'MANAGER';
      }
    } else {
      // 二階審核需要是 ADMIN 或 HR
      if (user.role !== 'ADMIN' && user.role !== 'HR') {
        return NextResponse.json({ error: '無權進行二階審核' }, { status: 403 });
      }
      reviewerRole = user.role;
    }

    // 取得員工名稱
    const employee = await prisma.employee.findUnique({
      where: { id: user.employeeId },
      select: { name: true }
    });

    // 建立審核紀錄
    await prisma.approvalReview.create({
      data: {
        instanceId,
        level: instance.currentLevel,
        reviewerId: user.employeeId,
        reviewerName: employee?.name || user.username,
        reviewerRole,
        action,
        comment: comment || null
      }
    });

    // 更新審核實例
    let newStatus: string;
    let newLevel = instance.currentLevel;

    if (action === 'REJECT') {
      // HR 的「不同意」僅為會簽意見，不阻擋流程，進入三階由管理員決核
      if (reviewerRole === 'HR') {
        // HR 不同意：記錄意見但繼續進入三階
        newLevel = 3;
        newStatus = 'LEVEL3_REVIEWING';
      } else {
        // 主管或管理員退回：終止流程
        newStatus = 'REJECTED';
      }
    } else {
      // APPROVE
      if (instance.currentLevel === 1) {
        // 一階通過 → 進入二階（HR會簽）
        newLevel = 2;
        newStatus = 'LEVEL2_REVIEWING';
      } else if (instance.currentLevel === 2) {
        // 二階通過（HR同意）→ 進入三階（管理員決核）
        newLevel = 3;
        newStatus = 'LEVEL3_REVIEWING';
      } else if (instance.currentLevel === 3) {
        // 三階通過 → 最終核准
        newStatus = 'APPROVED';
      } else if (instance.currentLevel < instance.maxLevel) {
        newLevel = instance.currentLevel + 1;
        newStatus = 'LEVEL2_REVIEWING';
      } else {
        newStatus = 'APPROVED';
      }
    }

    await prisma.approvalInstance.update({
      where: { id: instanceId },
      data: {
        status: newStatus,
        currentLevel: newLevel
      }
    });

    // 如果審核完成（已核准或已退回），同步更新原始申請狀態
    if (newStatus === 'APPROVED' || newStatus === 'REJECTED') {
      await updateRequestStatus(
        instance.requestType as WorkflowType,
        instance.requestId,
        newStatus as 'APPROVED' | 'REJECTED'
      );
      
      // 發送審核結果通知給申請人
      await notifyApplicant(
        instance as {
          id: number;
          requestType: string;
          requestId: number;
          applicantId: number;
          applicantName: string;
          department: string | null;
          currentLevel: number;
          status: string;
          deadlineAt: Date | null;
        },
        action,
        employee?.name || user.username,
        comment
      );
    } else if (newStatus === 'LEVEL2_REVIEWING') {
      // 通知二階審核者
      await notifyReviewers({
        ...instance,
        department: instance.department,
        deadlineAt: instance.deadlineAt,
        currentLevel: newLevel,
        status: newStatus
      });
    }

    return NextResponse.json({
      success: true,
      message: action === 'APPROVE' ? '已核准' : '已退回',
      newStatus,
      newLevel
    });

  } catch (error) {
    console.error('審核失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
