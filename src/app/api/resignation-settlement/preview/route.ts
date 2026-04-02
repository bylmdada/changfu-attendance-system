import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

// GET - 預覽離職結算（不實際執行）
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');

    if (!employeeId) {
      return NextResponse.json({ error: '缺少員工 ID' }, { status: 400 });
    }

    // 檢查員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        position: true,
        baseSalary: true,
        hireDate: true,
        isActive: true
      }
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到員工' }, { status: 404 });
    }

    // 檢查是否已結算過
    const existingSettlement = await prisma.resignationSettlement.findUnique({
      where: { employeeId: parseInt(employeeId) }
    });

    if (existingSettlement) {
      return NextResponse.json({ 
        error: '該員工已進行過離職結算',
        existingSettlement
      }, { status: 400 });
    }

    // ==================== 1. 補休餘額計算 ====================
    const compBalance = await prisma.compLeaveBalance.findUnique({
      where: { employeeId: parseInt(employeeId) }
    });

    const compLeaveConfirmed = compBalance ? (compBalance.totalEarned - compBalance.totalUsed) : 0;
    const compLeavePending = compBalance ? (compBalance.pendingEarn - compBalance.pendingUse) : 0;
    const totalCompLeaveHours = compLeaveConfirmed + compLeavePending;

    // ==================== 2. 特休假餘額計算 ====================
    const currentYear = new Date().getFullYear();
    const annualLeaves = await prisma.annualLeave.findMany({
      where: {
        employeeId: parseInt(employeeId),
        year: currentYear
      },
      select: {
        year: true,
        totalDays: true,
        usedDays: true,
        remainingDays: true,
        expiryDate: true
      }
    });

    const totalAnnualLeaveDays = annualLeaves.reduce((sum, leave) => sum + (leave.remainingDays || 0), 0);

    // ==================== 3. 計算結算金額 ====================
    const overtimeSettings = await prisma.systemSettings.findUnique({
      where: { key: 'overtime_calculation_settings' }
    });

    let monthlyBasicHours = 240;
    if (overtimeSettings) {
      const parsed = JSON.parse(overtimeSettings.value);
      monthlyBasicHours = parsed.monthlyBasicHours || 240;
    }

    // 計算費率（時薪 = 月薪 / 每月基本工時）
    const hourlyRate = employee.baseSalary / monthlyBasicHours;
    
    // 各項結算金額
    const compLeaveAmount = Math.round(totalCompLeaveHours * hourlyRate);
    // 特休結算金額 = 剩餘天數 × 8小時 × 時薪（勞基法標準）
    const annualLeaveAmount = Math.round(totalAnnualLeaveDays * 8 * hourlyRate);
    const totalAmount = compLeaveAmount + annualLeaveAmount;

    // 計算年資
    const hireDate = new Date(employee.hireDate);
    const now = new Date();
    const yearsOfService = Math.floor((now.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));

    return NextResponse.json({
      success: true,
      preview: {
        employee: {
          ...employee,
          yearsOfService
        },
        compLeave: {
          confirmedHours: compLeaveConfirmed,
          pendingHours: compLeavePending,
          totalHours: totalCompLeaveHours,
          hourlyRate: Math.round(hourlyRate * 100) / 100,
          amount: compLeaveAmount
        },
        annualLeave: {
          details: annualLeaves,
          totalDays: totalAnnualLeaveDays,
          totalHours: totalAnnualLeaveDays * 8,  // 天數 × 8小時
          hourlyRate: Math.round(hourlyRate * 100) / 100,
          amount: annualLeaveAmount
        },
        calculation: {
          formula: '月薪 ÷ 每月基本工時 = 時薪',
          monthlyBasicHours,
          baseSalary: employee.baseSalary,
          hourlyRate: Math.round(hourlyRate * 100) / 100
        },
        summary: {
          compLeaveAmount,
          annualLeaveAmount,
          totalAmount
        },
        canSettle: totalCompLeaveHours > 0 || totalAnnualLeaveDays > 0
      }
    });
  } catch (error) {
    console.error('預覽離職結算失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
