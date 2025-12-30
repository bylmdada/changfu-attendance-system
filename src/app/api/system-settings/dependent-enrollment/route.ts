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

export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
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

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.reportStatus = status;
    
    if (year && month) {
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0);
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

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const data = await request.json();
    const { dependentId, employeeId, dependentName, employeeName, type, effectiveDate, remarks } = data;

    if (!dependentId || !employeeId || !type || !effectiveDate) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const log = await prisma.dependentEnrollmentLog.create({
      data: {
        dependentId,
        employeeId,
        dependentName: dependentName || '',
        employeeName: employeeName || '',
        type,
        effectiveDate: new Date(effectiveDate),
        remarks,
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

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const data = await request.json();
    const { id, reportStatus, reportDate } = data;

    if (!id || !reportStatus) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { reportStatus };
    if (reportDate) {
      updateData.reportDate = new Date(reportDate);
    }

    const log = await prisma.dependentEnrollmentLog.update({
      where: { id },
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
