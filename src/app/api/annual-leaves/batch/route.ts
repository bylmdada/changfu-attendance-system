'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

/**
 * 台灣勞基法特休假天數計算
 * 依據《勞動基準法》第38條規定
 */
function calculateAnnualLeaveDays(yearsOfService: number, monthsOfService: number): number {
  const totalMonths = yearsOfService * 12 + monthsOfService;
  
  // 未滿6個月：0天
  if (totalMonths < 6) return 0;
  
  // 6個月以上未滿1年：3天
  if (totalMonths < 12) return 3;
  
  // 1年以上未滿2年：7天
  if (yearsOfService < 2) return 7;
  
  // 2年以上未滿3年：10天
  if (yearsOfService < 3) return 10;
  
  // 3年以上未滿5年：14天
  if (yearsOfService < 5) return 14;
  
  // 5年以上未滿10年：15天
  if (yearsOfService < 10) return 15;
  
  // 10年以上：15天 + 每滿1年加1天，最高30天
  return Math.min(30, 15 + (yearsOfService - 10));
}

/**
 * 計算年資（年和月）
 */
function calculateServiceDuration(hireDate: Date, referenceDate: Date): { years: number; months: number; totalMonths: number } {
  let years = referenceDate.getFullYear() - hireDate.getFullYear();
  let months = referenceDate.getMonth() - hireDate.getMonth();
  
  if (referenceDate.getDate() < hireDate.getDate()) {
    months--;
  }
  
  if (months < 0) {
    years--;
    months += 12;
  }
  
  if (years < 0) {
    years = 0;
    months = 0;
  }
  
  return { 
    years, 
    months,
    totalMonths: years * 12 + months
  };
}

/**
 * GET - 計算所有員工的建議特休假天數
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 只有管理員和HR可以使用
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const department = searchParams.get('department') || '';

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
      const suggestedDays = calculateAnnualLeaveDays(serviceDuration.years, serviceDuration.months);
      
      // 計算周年日
      const anniversaryDate = new Date(year, hireDate.getMonth(), hireDate.getDate());
      
      // 計算到期日（周年制：下一個周年日的前一天）
      const expiryDate = new Date(year + 1, hireDate.getMonth(), hireDate.getDate() - 1);
      
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
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 只有管理員和HR可以設定
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const body = await request.json();
    const { year, employeeIds } = body;

    if (!year || !employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return NextResponse.json({ error: '請提供年度和員工 ID 列表' }, { status: 400 });
    }

    // 取得員工資料
    const employees = await prisma.employee.findMany({
      where: {
        id: { in: employeeIds }
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

    const referenceDate = new Date(year, 11, 31);
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
        const totalDays = calculateAnnualLeaveDays(serviceDuration.years, serviceDuration.months);
        
        // 計算到期日（周年制：下一年的周年日前一天）
        const expiryDate = new Date(year + 1, hireDate.getMonth(), hireDate.getDate() - 1);

        await prisma.annualLeave.upsert({
          where: {
            employeeId_year: {
              employeeId: emp.id,
              year: year
            }
          },
          update: {
            yearsOfService: serviceDuration.years,
            totalDays,
            remainingDays: totalDays,
            expiryDate
          },
          create: {
            employeeId: emp.id,
            year: year,
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
