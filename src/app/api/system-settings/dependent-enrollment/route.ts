/**
 * 眷屬加退保記錄 API
 * GET: 取得加退保記錄
 * POST: 新增加退保記錄
 * PUT: 更新申報狀態
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

const VALID_ENROLLMENT_TYPES = new Set(['ENROLL', 'WITHDRAW']);
const VALID_REPORT_STATUSES = new Set(['PENDING', 'REPORTED', 'COMPLETED']);

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function parseDateValue(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    if (type && !VALID_ENROLLMENT_TYPES.has(type)) {
      return NextResponse.json({ error: '加退保類型無效' }, { status: 400 });
    }

    if (status && !VALID_REPORT_STATUSES.has(status)) {
      return NextResponse.json({ error: '申報狀態無效' }, { status: 400 });
    }

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.reportStatus = status;
    
    if (year && month) {
      const parsedYear = parsePositiveInteger(year);
      const parsedMonth = parsePositiveInteger(month);
      if (parsedYear === null || parsedMonth === null || parsedMonth > 12) {
        return NextResponse.json({ error: '年月篩選格式無效' }, { status: 400 });
      }

      const startDate = new Date(parsedYear, parsedMonth - 1, 1);
      const endDate = new Date(parsedYear, parsedMonth, 0);
      where.effectiveDate = {
        gte: startDate,
        lte: endDate
      };
    }

    const logs = await prisma.dependentEnrollmentLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    return NextResponse.json({
      success: true,
      logs
    });

  } catch (error) {
    console.error('取得加退保記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const data = parseResult.data;
    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { dependentId, employeeId, dependentName, employeeName, type, effectiveDate, remarks } = data;
    const parsedDependentId = parsePositiveInteger(dependentId);
    const parsedEmployeeId = parsePositiveInteger(employeeId);
    const parsedEffectiveDate = parseDateValue(effectiveDate);
    const normalizedDependentName = typeof dependentName === 'string' ? dependentName : '';
    const normalizedEmployeeName = typeof employeeName === 'string' ? employeeName : '';
    const normalizedRemarks = typeof remarks === 'string' ? remarks : null;

    if (
      !parsedDependentId ||
      !parsedEmployeeId ||
      typeof type !== 'string' ||
      typeof effectiveDate !== 'string' ||
      effectiveDate.trim() === ''
    ) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    if (!VALID_ENROLLMENT_TYPES.has(type)) {
      return NextResponse.json({ error: '加退保類型無效' }, { status: 400 });
    }

    if (!parsedEffectiveDate) {
      return NextResponse.json({ error: '生效日期格式無效' }, { status: 400 });
    }

    const log = await prisma.dependentEnrollmentLog.create({
      data: {
        dependentId: parsedDependentId,
        employeeId: parsedEmployeeId,
        dependentName: normalizedDependentName,
        employeeName: normalizedEmployeeName,
        type,
        effectiveDate: parsedEffectiveDate,
        remarks: normalizedRemarks,
        createdBy: user.username
      }
    });

    return NextResponse.json({
      success: true,
      message: type === 'ENROLL' ? '加保記錄已新增' : '退保記錄已新增',
      log
    });

  } catch (error) {
    console.error('新增加退保記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const data = parseResult.data;
    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { id, reportStatus, reportDate } = data;
    const parsedId = parsePositiveInteger(id);

    if (!parsedId || typeof reportStatus !== 'string' || reportStatus.trim() === '') {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    if (!VALID_REPORT_STATUSES.has(reportStatus)) {
      return NextResponse.json({ error: '申報狀態無效' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { reportStatus };
    if (reportDate) {
      const parsedReportDate = parseDateValue(reportDate);
      if (!parsedReportDate) {
        return NextResponse.json({ error: '申報日期格式無效' }, { status: 400 });
      }

      updateData.reportDate = parsedReportDate;
    }

    const log = await prisma.dependentEnrollmentLog.update({
      where: { id: parsedId },
      data: updateData
    });

    return NextResponse.json({
      success: true,
      message: '申報狀態已更新',
      log
    });

  } catch (error) {
    console.error('更新申報狀態失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
