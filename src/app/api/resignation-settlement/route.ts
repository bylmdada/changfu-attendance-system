import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// GET - 取得離職結算列表
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

    const decoded = verifyToken(token);
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const settlements = await prisma.resignationSettlement.findMany({
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
        processor: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({
      success: true,
      settlements
    });
  } catch (error) {
    console.error('取得離職結算列表失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 執行離職結算
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, notes } = body;

    if (!employeeId) {
      return NextResponse.json({ error: '缺少員工 ID' }, { status: 400 });
    }

    // 檢查員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) }
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到員工' }, { status: 404 });
    }

    // 檢查是否已結算過
    const existingSettlement = await prisma.resignationSettlement.findUnique({
      where: { employeeId: parseInt(employeeId) }
    });

    if (existingSettlement) {
      return NextResponse.json({ error: '該員工已進行過離職結算' }, { status: 400 });
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
      }
    });

    // 計算當年度剩餘特休天數
    const totalAnnualLeaveDays = annualLeaves.reduce((sum, leave) => sum + (leave.remainingDays || 0), 0);

    // ==================== 3. 計算結算金額 ====================
    // 取得系統設定的每月基本工時
    const overtimeSettings = await prisma.systemSettings.findUnique({
      where: { key: 'overtime_calculation_settings' }
    });

    let monthlyBasicHours = 240;
    if (overtimeSettings) {
      const parsed = JSON.parse(overtimeSettings.value);
      monthlyBasicHours = parsed.monthlyBasicHours || 240;
    }

    // 計算時薪 = 月薪 / 每月基本工時
    const hourlyRate = employee.baseSalary / monthlyBasicHours;
    
    // 補休結算金額 = 剩餘時數 × 時薪
    const compLeaveAmount = Math.round(totalCompLeaveHours * hourlyRate);
    
    // 特休結算金額 = 剩餘天數 × 8小時 × 時薪（勞基法標準）
    const annualLeaveAmount = Math.round(totalAnnualLeaveDays * 8 * hourlyRate);
    
    // 總結算金額
    const totalAmount = compLeaveAmount + annualLeaveAmount;

    // 如果沒有可結算項目
    if (totalCompLeaveHours <= 0 && totalAnnualLeaveDays <= 0) {
      return NextResponse.json({
        success: true,
        message: '該員工無剩餘補休時數或特休假，無需結算',
        settlement: null,
        summary: {
          compLeaveHours: 0,
          annualLeaveDays: 0,
          totalAmount: 0
        }
      });
    }

    // ==================== 4. 建立結算記錄 ====================
    const settlement = await prisma.resignationSettlement.create({
      data: {
        employeeId: parseInt(employeeId),
        compLeaveHours: totalCompLeaveHours,
        hourlyRate,
        totalAmount,
        settlementDate: new Date(),
        processedBy: decoded.employeeId,
        notes: notes ? `${notes}\n\n特休假餘額: ${totalAnnualLeaveDays} 天, 結算金額: $${annualLeaveAmount.toLocaleString()}` : 
               `特休假餘額: ${totalAnnualLeaveDays} 天, 結算金額: $${annualLeaveAmount.toLocaleString()}`
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            baseSalary: true
          }
        },
        processor: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // ==================== 5. 新增交易記錄 ====================
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    // 補休結算交易
    if (totalCompLeaveHours > 0) {
      await prisma.compLeaveTransaction.create({
        data: {
          employeeId: parseInt(employeeId),
          transactionType: 'SETTLE',
          hours: totalCompLeaveHours,
          referenceId: settlement.id,
          referenceType: 'RESIGNATION',
          yearMonth,
          description: `離職結算（補休）- 結算金額 $${compLeaveAmount.toLocaleString()}`,
          isFrozen: true
        }
      });

      // 清空補休餘額
      if (compBalance) {
        await prisma.compLeaveBalance.update({
          where: { employeeId: parseInt(employeeId) },
          data: {
            totalUsed: compBalance.totalEarned,
            balance: 0,
            pendingEarn: 0,
            pendingUse: 0
          }
        });
      }
    }

    // 特休假標記為已結算（將 remainingDays 設為 0）
    if (totalAnnualLeaveDays > 0) {
      await prisma.annualLeave.updateMany({
        where: {
          employeeId: parseInt(employeeId),
          year: currentYear
        },
        data: {
          usedDays: { increment: totalAnnualLeaveDays },
          remainingDays: 0
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: '離職結算已完成',
      settlement,
      summary: {
        compLeaveHours: totalCompLeaveHours,
        compLeaveAmount,
        annualLeaveDays: totalAnnualLeaveDays,
        annualLeaveHours: totalAnnualLeaveDays * 8,  // 天數 × 8小時
        annualLeaveAmount,
        hourlyRate: Math.round(hourlyRate * 100) / 100,
        totalAmount
      }
    });
  } catch (error) {
    console.error('執行離職結算失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
