/**
 * 國定假日補休管理 API
 * 
 * 追蹤員工的國定假日休假/補休狀態
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// GET - 取得國定假日補休記錄
export async function GET(request: NextRequest) {
  try {
    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const parsedYear = parseIntegerQueryParam(searchParams.get('year'), {
      defaultValue: new Date().getFullYear(),
      min: 2000,
      max: 2100,
    });
    const parsedEmployeeId = parseIntegerQueryParam(searchParams.get('employeeId'), { min: 1 });

    if (!parsedYear.isValid || parsedYear.value === null) {
      return NextResponse.json({ error: 'year 格式錯誤' }, { status: 400 });
    }

    if (!parsedEmployeeId.isValid) {
      return NextResponse.json({ error: 'employeeId 格式錯誤' }, { status: 400 });
    }

    const year = parsedYear.value;

    // 取得用戶角色
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true, employeeId: true }
    });

    if (!user) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    // 根據角色決定查詢範圍
    const isAdmin = user.role === 'ADMIN' || user.role === 'HR';
    
    const whereClause: { year: number; employeeId?: number } = { year };
    
    if (parsedEmployeeId.value !== null && isAdmin) {
      whereClause.employeeId = parsedEmployeeId.value;
    } else if (!isAdmin && user.employeeId) {
      whereClause.employeeId = user.employeeId;
    }

    // 取得該年度所有國定假日
    const holidays = await prisma.holiday.findMany({
      where: { year, isActive: true },
      orderBy: { date: 'asc' }
    });

    // 取得補休記錄
    const compensations = await prisma.holidayCompensation.findMany({
      where: whereClause,
      include: {
        employee: {
          select: { id: true, name: true, employeeId: true, department: true }
        }
      },
      orderBy: { holidayDate: 'asc' }
    });

    return NextResponse.json({
      success: true,
      holidays,
      compensations,
      year
    });
  } catch (error) {
    console.error('取得國定假日補休記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 建立或更新補休記錄
export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: csrfResult.error || 'CSRF驗證失敗' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 檢查權限
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true }
    });

    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的補休資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的補休資料' }, { status: 400 });
    }

    const parsedEmployeeId = parseIntegerQueryParam(
      typeof body.employeeId === 'number' ? String(body.employeeId) : typeof body.employeeId === 'string' ? body.employeeId : null,
      { min: 1 }
    );
    const parsedHolidayId = parseIntegerQueryParam(
      typeof body.holidayId === 'number' ? String(body.holidayId) : typeof body.holidayId === 'string' ? body.holidayId : null,
      { min: 1 }
    );

    if (!parsedEmployeeId.isValid) {
      return NextResponse.json({ error: 'employeeId 格式錯誤' }, { status: 400 });
    }

    if (!parsedHolidayId.isValid) {
      return NextResponse.json({ error: 'holidayId 格式錯誤' }, { status: 400 });
    }

    if (parsedEmployeeId.value === null || parsedHolidayId.value === null) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const workedOnDate = typeof body.workedOnDate === 'boolean' ? body.workedOnDate : undefined;
    const compensationDate = typeof body.compensationDate === 'string' ? body.compensationDate : null;
    const status = typeof body.status === 'string' ? body.status : undefined;
    const notes = typeof body.notes === 'string' ? body.notes : null;

    // 取得國定假日資訊
    const holiday = await prisma.holiday.findUnique({
      where: { id: parsedHolidayId.value }
    });

    if (!holiday) {
      return NextResponse.json({ error: '國定假日不存在' }, { status: 404 });
    }

    // 建立或更新補休記錄
    const compensation = await prisma.holidayCompensation.upsert({
      where: {
        employeeId_holidayId: {
          employeeId: parsedEmployeeId.value,
          holidayId: parsedHolidayId.value
        }
      },
      update: {
        workedOnDate: workedOnDate ?? false,
        compensationDate: compensationDate ? new Date(compensationDate) : null,
        status: status || (workedOnDate ? 'PENDING' : 'NOT_REQUIRED'),
        notes: notes || null,
        updatedAt: new Date()
      },
      create: {
        employeeId: parsedEmployeeId.value,
        holidayId: parsedHolidayId.value,
        holidayDate: holiday.date,
        holidayName: holiday.name,
        workedOnDate: workedOnDate ?? false,
        compensationDate: compensationDate ? new Date(compensationDate) : null,
        status: status || (workedOnDate ? 'PENDING' : 'NOT_REQUIRED'),
        year: holiday.year,
        notes: notes || null
      }
    });

    return NextResponse.json({
      success: true,
      compensation,
      message: '補休記錄已更新'
    });
  } catch (error) {
    console.error('更新國定假日補休記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT - 設定補休日期
export async function PUT(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: csrfResult.error || 'CSRF驗證失敗' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 檢查權限
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true }
    });

    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的補休資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的補休資料' }, { status: 400 });
    }

    const parsedId = parseIntegerQueryParam(
      typeof body.id === 'number' ? String(body.id) : typeof body.id === 'string' ? body.id : null,
      { min: 1 }
    );

    if (!parsedId.isValid) {
      return NextResponse.json({ error: '記錄ID 格式錯誤' }, { status: 400 });
    }

    if (parsedId.value === null) {
      return NextResponse.json({ error: '缺少記錄 ID' }, { status: 400 });
    }

    const compensationDate = typeof body.compensationDate === 'string' ? body.compensationDate : null;

    // 更新補休日期
    const compensation = await prisma.holidayCompensation.update({
      where: { id: parsedId.value },
      data: {
        compensationDate: compensationDate ? new Date(compensationDate) : null,
        status: compensationDate ? 'TAKEN' : 'PENDING',
        updatedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      compensation,
      message: compensationDate ? '補休日期已設定' : '補休日期已清除'
    });
  } catch (error) {
    console.error('設定補休日期失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
