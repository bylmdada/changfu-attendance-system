'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import {
  calculateAnnualLeaveDaysByTotalMonths,
  calculateAnnualLeaveExpiryDate,
  calculateServiceDuration,
} from '@/lib/annual-leave-rules';

function parsePositiveIntegerBodyValue(value: unknown, defaultValue?: number) {
  if (value === undefined || value === null || value === '') {
    return {
      value: defaultValue ?? null,
      isValid: true,
    };
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return {
      value: null,
      isValid: false,
    };
  }

  return parseIntegerQueryParam(String(value), {
    defaultValue: defaultValue ?? null,
    min: 1,
    max: 99999999,
  });
}

function parseEmployeeIdsBody(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      value: undefined,
      isValid: false,
    };
  }

  const parsedIds: number[] = [];
  for (const item of value) {
    const parsedItem = parsePositiveIntegerBodyValue(item);
    if (!parsedItem.isValid || parsedItem.value === null) {
      return {
        value: undefined,
        isValid: false,
      };
    }

    parsedIds.push(parsedItem.value);
  }

  return {
    value: parsedIds,
    isValid: true,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * GET - 計算所有員工的建議特休假天數
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以使用
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearResult = parseIntegerQueryParam(searchParams.get('year'), {
      defaultValue: new Date().getFullYear(),
      min: 1,
      max: 9999,
    });
    const department = searchParams.get('department') || '';

    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json({ error: 'year 參數格式無效' }, { status: 400 });
    }

    const year = yearResult.value;

    // 取得所有在職員工
    const whereClause: { isActive: boolean; department?: string } = { isActive: true };
    if (department) {
      whereClause.department = department;
    }

    const employees = await prisma.employee.findMany({
      where: whereClause,
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        position: true,
        hireDate: true,
        annualLeaves: {
          where: { year },
          select: {
            id: true,
            totalDays: true,
            remainingDays: true,
            usedDays: true
          }
        }
      },
      orderBy: [
        { department: 'asc' },
        { name: 'asc' }
      ]
    });

    // 計算參考日期（該年度的12月31日，用於計算年資）
    const referenceDate = new Date(year, 11, 31);

    // 計算每位員工的建議特休假
    const employeesWithCalculation = employees.map(emp => {
      const hireDate = new Date(emp.hireDate);
      const serviceDuration = calculateServiceDuration(hireDate, referenceDate);
      const suggestedDays = calculateAnnualLeaveDaysByTotalMonths(serviceDuration.totalMonths);
      
      // 計算周年日
      const anniversaryDate = new Date(year, hireDate.getMonth(), hireDate.getDate());
      
      // 計算到期日（周年制：下一個周年日的前一天）
      const expiryDate = calculateAnnualLeaveExpiryDate(hireDate, year);
      
      const existingLeave = emp.annualLeaves[0];
      
      return {
        id: emp.id,
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department,
        position: emp.position,
        hireDate: emp.hireDate,
        yearsOfService: serviceDuration.years,
        monthsOfService: serviceDuration.months,
        totalMonths: serviceDuration.totalMonths,
        suggestedDays,
        anniversaryDate: anniversaryDate.toISOString().split('T')[0],
        expiryDate: expiryDate.toISOString().split('T')[0],
        hasExisting: !!existingLeave,
        existingDays: existingLeave?.totalDays || 0,
        existingRemaining: existingLeave?.remainingDays || 0,
        existingUsed: existingLeave?.usedDays || 0,
        status: serviceDuration.totalMonths < 6 
          ? 'NOT_ELIGIBLE' 
          : existingLeave 
            ? 'ALREADY_SET'
            : 'NOT_SET'
      };
    });

    // 統計
    const stats = {
      total: employeesWithCalculation.length,
      notEligible: employeesWithCalculation.filter(e => e.status === 'NOT_ELIGIBLE').length,
      alreadySet: employeesWithCalculation.filter(e => e.status === 'ALREADY_SET').length,
      notSet: employeesWithCalculation.filter(e => e.status === 'NOT_SET').length,
      totalSuggestedDays: employeesWithCalculation.reduce((sum, e) => sum + e.suggestedDays, 0)
    };

    return NextResponse.json({ 
      employees: employeesWithCalculation,
      stats,
      year,
      rules: {
        description: '依據《勞動基準法》第38條規定計算',
        table: [
          { range: '未滿6個月', days: 0 },
          { range: '6個月以上未滿1年', days: 3 },
          { range: '1年以上未滿2年', days: 7 },
          { range: '2年以上未滿3年', days: 10 },
          { range: '3年以上未滿5年', days: 14 },
          { range: '5年以上未滿10年', days: 15 },
          { range: '10年以上', days: '15 + 每年加1天，最高30天' }
        ]
      }
    });
  } catch (error) {
    console.error('計算特休假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

/**
 * POST - 批量設定特休假
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/annual-leaves/batch');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '操作過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.retryAfter 
        },
        { 
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          }
        }
      );
    }

    // 2. CSRF保護檢查
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    // 3. 身份驗證
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以設定
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的批次設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的批次設定資料' }, { status: 400 });
    }

    const { year, employeeIds } = body;

    const yearResult = parsePositiveIntegerBodyValue(year);
    const employeeIdsResult = parseEmployeeIdsBody(employeeIds);

    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json({ error: 'year 參數格式無效' }, { status: 400 });
    }

    if (!employeeIdsResult.isValid || employeeIdsResult.value === undefined) {
      return NextResponse.json({ error: 'employeeIds 參數格式無效' }, { status: 400 });
    }

    if (!year || !employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return NextResponse.json({ error: '請提供年度和員工 ID 列表' }, { status: 400 });
    }

    const yearValue = yearResult.value;
    const employeeIdValues = employeeIdsResult.value;

    // 取得員工資料
    const employees = await prisma.employee.findMany({
      where: {
        id: { in: employeeIdValues }
      },
      select: {
        id: true,
        hireDate: true,
        name: true
      }
    });

    if (employees.length === 0) {
      return NextResponse.json({ error: '找不到指定的員工' }, { status: 404 });
    }

    const referenceDate = new Date(yearValue, 11, 31);
    const results: { success: number; failed: number; details: Array<{ employeeId: number; name: string; days: number; status: string }> } = {
      success: 0,
      failed: 0,
      details: []
    };

    // 批量處理每位員工
    for (const emp of employees) {
      try {
        const hireDate = new Date(emp.hireDate);
        const serviceDuration = calculateServiceDuration(hireDate, referenceDate);
        const totalDays = calculateAnnualLeaveDaysByTotalMonths(serviceDuration.totalMonths);
        const existingAnnualLeave = await prisma.annualLeave.findUnique({
          where: {
            employeeId_year: {
              employeeId: emp.id,
              year: yearValue,
            }
          },
          select: {
            usedDays: true,
          }
        });
        const remainingDays = Math.max(0, totalDays - (existingAnnualLeave?.usedDays ?? 0));
        
        // 計算到期日（周年制：下一年的周年日前一天）
        const expiryDate = calculateAnnualLeaveExpiryDate(hireDate, yearValue);

        await prisma.annualLeave.upsert({
          where: {
            employeeId_year: {
              employeeId: emp.id,
              year: yearValue
            }
          },
          update: {
            yearsOfService: serviceDuration.years,
            totalDays,
            remainingDays,
            expiryDate
          },
          create: {
            employeeId: emp.id,
            year: yearValue,
            yearsOfService: serviceDuration.years,
            totalDays,
            remainingDays: totalDays,
            expiryDate
          }
        });

        results.success++;
        results.details.push({
          employeeId: emp.id,
          name: emp.name,
          days: totalDays,
          status: 'success'
        });
      } catch (err) {
        console.error(`設定員工 ${emp.id} 特休假失敗:`, err);
        results.failed++;
        results.details.push({
          employeeId: emp.id,
          name: emp.name,
          days: 0,
          status: 'failed'
        });
      }
    }

    if (results.success === 0) {
      return NextResponse.json(
        {
          error: '批量設定特休假失敗，請稍後再試',
          results,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `已成功設定 ${results.success} 位員工的特休假`,
      results
    });
  } catch (error) {
    console.error('批量設定特休假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
