import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function parsePositiveIntegerInput(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!/^\d+$/.test(trimmedValue)) {
      return null;
    }

    const parsedValue = Number(trimmedValue);
    return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  return null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : undefined;
}

// GET - 取得離職結算列表
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!['ADMIN', 'HR'].includes(decoded.role)) {
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

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const body = parsedBody.data;
    if (!body || Array.isArray(body)) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const employeeId = parsePositiveIntegerInput(body.employeeId);
    const notes = normalizeOptionalString(body.notes);

    if (!employeeId) {
      if (body.employeeId === undefined || body.employeeId === null || body.employeeId === '') {
        return NextResponse.json({ error: '缺少員工 ID' }, { status: 400 });
      }

      return NextResponse.json({ error: '員工ID格式無效' }, { status: 400 });
    }

    // 檢查員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId }
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到員工' }, { status: 404 });
    }

    // 檢查是否已結算過
    const existingSettlement = await prisma.resignationSettlement.findUnique({
      where: { employeeId }
    });

    if (existingSettlement) {
      return NextResponse.json({ error: '該員工已進行過離職結算' }, { status: 400 });
    }

    // ==================== 1. 補休餘額計算 ====================
    const compBalance = await prisma.compLeaveBalance.findUnique({
      where: { employeeId }
    });

    const compLeaveConfirmed = compBalance ? (compBalance.totalEarned - compBalance.totalUsed) : 0;
    const compLeavePending = compBalance ? (compBalance.pendingEarn - compBalance.pendingUse) : 0;
    const totalCompLeaveHours = compLeaveConfirmed + compLeavePending;

    // ==================== 2. 特休假餘額計算 ====================
    const currentYear = new Date().getFullYear();
    const annualLeaves = await prisma.annualLeave.findMany({
      where: {
        employeeId,
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

    // ==================== 4. 建立結算記錄與清帳 ====================
    const settlement = await prisma.$transaction(async (tx) => {
      const createdSettlement = await tx.resignationSettlement.create({
        data: {
          employeeId,
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

      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      if (totalCompLeaveHours > 0) {
        await tx.compLeaveTransaction.create({
          data: {
            employeeId,
            transactionType: 'SETTLE',
            hours: totalCompLeaveHours,
            referenceId: createdSettlement.id,
            referenceType: 'RESIGNATION',
            yearMonth,
            description: `離職結算（補休）- 結算金額 $${compLeaveAmount.toLocaleString()}`,
            isFrozen: true
          }
        });

        if (compBalance) {
          await tx.compLeaveBalance.update({
            where: { employeeId },
            data: {
              totalUsed: compBalance.totalEarned,
              balance: 0,
              pendingEarn: 0,
              pendingUse: 0
            }
          });
        }
      }

      if (totalAnnualLeaveDays > 0) {
        await tx.annualLeave.updateMany({
          where: {
            employeeId,
            year: currentYear
          },
          data: {
            usedDays: { increment: totalAnnualLeaveDays },
            remainingDays: 0
          }
        });
      }

      return createdSettlement;
    });

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
