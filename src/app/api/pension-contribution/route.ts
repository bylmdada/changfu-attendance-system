'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  calculatePensionContributionEffectiveDate,
  getEffectivePensionContributionRate,
} from '@/lib/pension-contribution';
import { getTaiwanTodayEnd, toTaiwanDateStr } from '@/lib/timezone';
import { safeParseJSON } from '@/lib/validation';

/**
 * 勞退自提管理 API
 * - 員工：查看自己的自提比例與申請歷史
 * - HR/ADMIN：查看所有申請（待審核列表）
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDuplicatePendingApplicationError(error: unknown): boolean {
  if (!isPlainObject(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';

  return code === 'P2002' || message.includes('UNIQUE constraint failed');
}

function parsePercentageValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

// GET: 取得自提資訊與申請歷史
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: '請求過於頻繁' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode'); // 'pending' for HR/Admin to see pending applications
    
    const isAdminOrHR = user.role === 'ADMIN' || user.role === 'HR';

    // HR/Admin 查看待審核列表
    if (mode === 'pending' && isAdminOrHR) {
      const statusFilter = user.role === 'ADMIN' 
        ? ['PENDING_HR', 'PENDING_ADMIN'] // Admin 可看到並直接審核所有待處理的
        : ['PENDING_HR'];    // HR 看待審核的
      
      const pendingApplications = await prisma.pensionContributionApplication.findMany({
        where: {
          status: { in: statusFilter }
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              department: true,
              position: true,
              laborPensionSelfRate: true
            }
          },
          hrReviewer: {
            select: { id: true, name: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return NextResponse.json({
        success: true,
        applications: pendingApplications.map(app => ({
          id: app.id,
          employee: app.employee,
          currentRate: app.currentRate,
          requestedRate: app.requestedRate,
          effectiveDate: toTaiwanDateStr(app.effectiveDate),
          reason: app.reason,
          status: app.status,
          hrReviewer: app.hrReviewer,
          hrOpinion: app.hrOpinion,
          hrNote: app.hrNote,
          createdAt: app.createdAt.toISOString()
        }))
      });
    }

    // 員工查看自己的資訊
    const employee = await prisma.employee.findUnique({
      where: { id: user.employeeId },
      select: {
        id: true,
        employeeId: true,
        name: true,
        laborPensionSelfRate: true,
        baseSalary: true,
        insuredBase: true
      }
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    const currentRate = await getEffectivePensionContributionRate(
      prisma.pensionContributionApplication,
      employee.id,
      employee.laborPensionSelfRate || 0,
      getTaiwanTodayEnd()
    );

    // 取得申請歷史
    const applications = await prisma.pensionContributionApplication.findMany({
      where: { employeeId: user.employeeId },
      include: {
        hrReviewer: { select: { id: true, name: true } },
        adminApprover: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // 計算目前自提金額（預估）
    const insuredBase = employee.insuredBase || employee.baseSalary || 0;
    const monthlyAmount = Math.round(insuredBase * currentRate / 100);

    return NextResponse.json({
      success: true,
      currentInfo: {
        currentRate,
        insuredBase,
        monthlyAmount,
        maxRate: 6,
        minRate: 0
      },
      applications: applications.map(app => ({
        id: app.id,
        currentRate: app.currentRate,
        requestedRate: app.requestedRate,
        effectiveDate: toTaiwanDateStr(app.effectiveDate),
        reason: app.reason,
        status: app.status,
        hrOpinion: app.hrOpinion,
        hrNote: app.hrNote,
        hrReviewer: app.hrReviewer,
        adminNote: app.adminNote,
        adminApprover: app.adminApprover,
        createdAt: app.createdAt.toISOString()
      })),
      // 是否有待處理的申請
      hasPendingApplication: applications.some(a => 
        ['PENDING_HR', 'PENDING_ADMIN'].includes(a.status)
      )
    });
  } catch (error) {
    console.error('取得勞退自提資訊失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST: 提交自提比例變更申請
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: '請求過於頻繁' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const requestedRate = parsePercentageValue(parsedBody.data?.requestedRate);
    const reason = typeof parsedBody.data?.reason === 'string' ? parsedBody.data.reason.trim() : null;

    // 驗證比例範圍
    if (requestedRate === null || requestedRate < 0 || requestedRate > 6) {
      return NextResponse.json({ error: '自提比例必須在 0% ~ 6% 之間' }, { status: 400 });
    }

    // 只允許整數或 0.5 的倍數
    if (requestedRate % 0.5 !== 0) {
      return NextResponse.json({ error: '自提比例須為 0.5% 的倍數' }, { status: 400 });
    }

    // 取得員工資料
    const employee = await prisma.employee.findUnique({
      where: { id: user.employeeId },
      select: { id: true, laborPensionSelfRate: true }
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    const currentRate = employee.laborPensionSelfRate || 0;

    // 檢查是否有待處理的申請
    const pendingApp = await prisma.pensionContributionApplication.findFirst({
      where: {
        employeeId: user.employeeId,
        status: { in: ['PENDING_HR', 'PENDING_ADMIN'] }
      }
    });

    if (pendingApp) {
      return NextResponse.json({ 
        error: '您有待處理的申請，請等待審核完成後再提出新申請' 
      }, { status: 400 });
    }

    // 計算生效日期
    const effectiveDate = calculatePensionContributionEffectiveDate(new Date());

    // 建立申請
    const application = await prisma.pensionContributionApplication.create({
      data: {
        employeeId: user.employeeId,
        currentRate,
        requestedRate,
        effectiveDate,
        reason: reason || null
      }
    });

    return NextResponse.json({
      success: true,
      message: '申請已提交，待 HR 審核',
      application: {
        id: application.id,
        currentRate,
        requestedRate,
        effectiveDate: toTaiwanDateStr(effectiveDate),
        status: application.status
      }
    }, { status: 201 });
  } catch (error) {
    console.error('提交勞退自提申請失敗:', error);
    if (isDuplicatePendingApplicationError(error)) {
      return NextResponse.json({
        error: '您有待處理的申請，請等待審核完成後再提出新申請'
      }, { status: 400 });
    }
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
