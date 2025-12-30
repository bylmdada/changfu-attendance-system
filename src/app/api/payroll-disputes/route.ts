/**
 * 薪資異議申請 API
 * GET: 取得異議申請列表（管理員看全部，員工看自己）
 * POST: 提交異議申請
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';

// 異議類型
const DISPUTE_TYPES = [
  'OVERTIME_MISSING',      // 漏報加班
  'LEAVE_MISSING',         // 漏報請假
  'CALCULATION_ERROR',     // 計算錯誤
  'ALLOWANCE_MISSING',     // 津貼漏發
  'DEDUCTION_ERROR',       // 扣款錯誤
  'OTHER'                  // 其他
];

export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const myOnly = searchParams.get('myOnly') === 'true';

    // 建立查詢條件
    const where: Record<string, unknown> = {};

    // 非管理員只能看自己的申請，或者明確要求只看自己的
    if ((user.role !== 'ADMIN' && user.role !== 'HR') || myOnly) {
      where.employeeId = user.employeeId;
    }

    if (status) {
      where.status = status;
    }

    if (year) {
      where.payYear = parseInt(year);
    }

    if (month) {
      where.payMonth = parseInt(month);
    }

    const disputes = await prisma.payrollDispute.findMany({
      where,
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
        reviewer: {
          select: {
            id: true,
            name: true
          }
        },
        adjustment: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // 統計
    const stats = {
      pending: disputes.filter(d => d.status === 'PENDING').length,
      approved: disputes.filter(d => d.status === 'APPROVED').length,
      rejected: disputes.filter(d => d.status === 'REJECTED').length,
      total: disputes.length
    };

    return NextResponse.json({
      success: true,
      disputes,
      stats
    });

  } catch (error) {
    console.error('取得薪資異議失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // 速率限制
    const rateLimitResult = await checkRateLimit(request, '/api/payroll-disputes');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const data = await request.json();
    const { payYear, payMonth, type, description, requestedAmount, fileUrl } = data;

    // 驗證必填欄位
    if (!payYear || !payMonth || !type || !description) {
      return NextResponse.json({ error: '請填寫所有必填欄位' }, { status: 400 });
    }

    // 驗證異議類型
    if (!DISPUTE_TYPES.includes(type)) {
      return NextResponse.json({ error: '無效的異議類型' }, { status: 400 });
    }

    // 檢查是否有對應的薪資記錄
    const payroll = await prisma.payrollRecord.findFirst({
      where: {
        employeeId: user.employeeId,
        payYear: parseInt(payYear),
        payMonth: parseInt(payMonth)
      }
    });

    // 檢查是否已有相同月份的待審核異議
    const existingPending = await prisma.payrollDispute.findFirst({
      where: {
        employeeId: user.employeeId,
        payYear: parseInt(payYear),
        payMonth: parseInt(payMonth),
        status: 'PENDING'
      }
    });

    if (existingPending) {
      return NextResponse.json({ 
        error: '該月份已有待審核的異議申請，請等待審核結果' 
      }, { status: 400 });
    }

    // 建立異議申請
    const dispute = await prisma.payrollDispute.create({
      data: {
        employeeId: user.employeeId,
        payrollId: payroll?.id || null,
        payYear: parseInt(payYear),
        payMonth: parseInt(payMonth),
        type,
        description,
        requestedAmount: requestedAmount ? parseFloat(requestedAmount) : null,
        fileUrl: fileUrl || null
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        }
      }
    });

    // 建立審核實例
    await createApprovalForRequest({
      requestType: 'PAYROLL_DISPUTE',
      requestId: dispute.id,
      applicantId: dispute.employee.id,
      applicantName: dispute.employee.name,
      department: dispute.employee.department
    });

    return NextResponse.json({
      success: true,
      dispute,
      message: '薪資異議申請已提交'
    });

  } catch (error) {
    console.error('提交薪資異議失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
