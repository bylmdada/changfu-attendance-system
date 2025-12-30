/**
 * 國定假日補休管理 API
 * 
 * 追蹤員工的國定假日休假/補休狀態
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { validateCSRF } from '@/lib/csrf';

// GET - 取得國定假日補休記錄
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const employeeId = searchParams.get('employeeId');

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
    
    let whereClause: { year: number; employeeId?: number } = { year };
    
    if (employeeId && isAdmin) {
      whereClause.employeeId = parseInt(employeeId);
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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 檢查權限
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true }
    });

    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, holidayId, workedOnDate, compensationDate, status, notes } = body;

    if (!employeeId || !holidayId) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    // 取得國定假日資訊
    const holiday = await prisma.holiday.findUnique({
      where: { id: holidayId }
    });

    if (!holiday) {
      return NextResponse.json({ error: '國定假日不存在' }, { status: 404 });
    }

    // 建立或更新補休記錄
    const compensation = await prisma.holidayCompensation.upsert({
      where: {
        employeeId_holidayId: {
          employeeId: parseInt(employeeId),
          holidayId: parseInt(holidayId)
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
        employeeId: parseInt(employeeId),
        holidayId: parseInt(holidayId),
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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 檢查權限
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true }
    });

    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { id, compensationDate } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少記錄 ID' }, { status: 400 });
    }

    // 更新補休日期
    const compensation = await prisma.holidayCompensation.update({
      where: { id: parseInt(id) },
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
