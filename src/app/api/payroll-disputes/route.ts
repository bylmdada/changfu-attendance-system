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
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringOrNumber(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return null;
}

function parseOptionalFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return { value: null, isValid: true };
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return { value: null, isValid: false };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { value: null, isValid: false };
  }

  return { value: parsed, isValid: true };
}

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
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const yearResult = parseIntegerQueryParam(searchParams.get('year'), { min: 1900, max: 9999 });
    const monthResult = parseIntegerQueryParam(searchParams.get('month'), { min: 1, max: 12 });
    const myOnly = searchParams.get('myOnly') === 'true';

    if (!yearResult.isValid) {
      return NextResponse.json({ error: 'year 格式錯誤' }, { status: 400 });
    }

    if (!monthResult.isValid) {
      return NextResponse.json({ error: 'month 格式錯誤' }, { status: 400 });
    }

    // 建立查詢條件
    const where: Record<string, unknown> = {};

    // 非管理員只能看自己的申請，或者明確要求只看自己的
    if ((user.role !== 'ADMIN' && user.role !== 'HR') || myOnly) {
      where.employeeId = user.employeeId;
    }

    if (status) {
      where.status = status;
    }

    if (yearResult.value !== null) {
      where.payYear = yearResult.value;
    }

    if (monthResult.value !== null) {
      where.payMonth = monthResult.value;
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

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的異議資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的異議資料' }, { status: 400 });
    }

    const payYearInput = asStringOrNumber(data.payYear);
    const payMonthInput = asStringOrNumber(data.payMonth);
    const type = typeof data.type === 'string' ? data.type : undefined;
    const description = typeof data.description === 'string' ? data.description : undefined;
    const requestedAmountResult = parseOptionalFiniteNumber(data.requestedAmount);
    const fileUrl = typeof data.fileUrl === 'string' ? data.fileUrl : null;

    // 驗證必填欄位
    if (!payYearInput || !payMonthInput || !type || !description) {
      return NextResponse.json({ error: '請填寫所有必填欄位' }, { status: 400 });
    }

    const payYearResult = parseIntegerQueryParam(payYearInput, { min: 1900, max: 9999 });
    if (!payYearResult.isValid || payYearResult.value === null) {
      return NextResponse.json({ error: 'payYear 格式錯誤' }, { status: 400 });
    }

    const payMonthResult = parseIntegerQueryParam(payMonthInput, { min: 1, max: 12 });
    if (!payMonthResult.isValid || payMonthResult.value === null) {
      return NextResponse.json({ error: 'payMonth 格式錯誤' }, { status: 400 });
    }

    if (!requestedAmountResult.isValid) {
      return NextResponse.json({ error: 'requestedAmount 格式錯誤' }, { status: 400 });
    }

    // 驗證異議類型
    if (!DISPUTE_TYPES.includes(type)) {
      return NextResponse.json({ error: '無效的異議類型' }, { status: 400 });
    }

    // 檢查是否有對應的薪資記錄
    const payroll = await prisma.payrollRecord.findFirst({
      where: {
        employeeId: user.employeeId,
        payYear: payYearResult.value,
        payMonth: payMonthResult.value
      }
    });

    // 檢查是否已有相同月份的待審核異議
    const existingPending = await prisma.payrollDispute.findFirst({
      where: {
        employeeId: user.employeeId,
        payYear: payYearResult.value,
        payMonth: payMonthResult.value,
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
        payYear: payYearResult.value,
        payMonth: payMonthResult.value,
        type,
        description,
        requestedAmount: requestedAmountResult.value,
        fileUrl
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
