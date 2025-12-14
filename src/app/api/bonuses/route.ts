import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { 
  calculateBonusSupplementaryPremium, 
  getInsuredAmount 
} from '@/lib/tax-calculator';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/bonuses');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // 認證檢查
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 權限檢查：只有管理員和HR可以查看所有獎金記錄
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    // 查詢獎金記錄
    const whereClause: Record<string, number> = {};
    
    if (employeeId) {
      whereClause.employeeId = parseInt(employeeId);
    }
    
    if (year) {
      whereClause.payrollYear = parseInt(year);
    }
    
    if (month) {
      whereClause.payrollMonth = parseInt(month);
    }

    const bonusRecords = await prisma.bonusRecord.findMany({
      where: whereClause,
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
        annualBonus: true,
        creator: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [
        { payrollYear: 'desc' },
        { payrollMonth: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    // 如果查詢特定員工的年度累計，同時返回年度統計
    let annualSummary = null;
    if (employeeId && year) {
      annualSummary = await prisma.employeeAnnualBonus.findUnique({
        where: {
          employeeId_year: {
            employeeId: parseInt(employeeId),
            year: parseInt(year)
          }
        }
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        records: bonusRecords,
        annualSummary
      }
    });

  } catch (error) {
    console.error('獎金記錄查詢失敗:', error);
    return NextResponse.json(
      { success: false, error: '獎金記錄查詢失敗' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/bonuses');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF 保護
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 認證檢查
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 權限檢查
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const body = await request.json();
    const {
      employeeId,
      bonusType,
      bonusTypeName,
      amount,
      payrollYear,
      payrollMonth,
      createdBy,
      adjustmentReason,
      originalRecordId
    } = body;

    // 驗證必要欄位
    if (!employeeId || !bonusType || !amount || !payrollYear || !payrollMonth || !createdBy) {
      return NextResponse.json(
        { success: false, error: '缺少必要欄位' },
        { status: 400 }
      );
    }

    // 檢查員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { 
        id: true, 
        name: true, 
        baseSalary: true,
        dependents: true
      }
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: '員工不存在' },
        { status: 404 }
      );
    }

    // 取得或創建年度獎金累計記錄
    const annualBonus = await prisma.employeeAnnualBonus.upsert({
      where: {
        employeeId_year: {
          employeeId: employeeId,
          year: payrollYear
        }
      },
      create: {
        employeeId: employeeId,
        year: payrollYear,
        totalBonusAmount: 0,
        supplementaryPremium: 0
      },
      update: {}
    });

    // 計算健保投保金額
    const insuredAmount = getInsuredAmount(employee.baseSalary);

    // 計算補充保費
    const supplementaryCalculation = calculateBonusSupplementaryPremium(
      insuredAmount,
      annualBonus.totalBonusAmount,
      amount
    );

    // 開始事務處理
    const result = await prisma.$transaction(async (tx) => {
      // 創建獎金記錄
      const bonusRecord = await tx.bonusRecord.create({
        data: {
          employeeId,
          annualBonusId: annualBonus.id,
          bonusType,
          bonusTypeName: bonusTypeName || bonusType,
          amount,
          payrollYear,
          payrollMonth,
          insuredAmount,
          exemptThreshold: supplementaryCalculation.exemptThreshold,
          cumulativeBonusBefore: supplementaryCalculation.currentYearBonusTotal,
          cumulativeBonusAfter: supplementaryCalculation.currentYearBonusTotal + amount,
          calculationBase: supplementaryCalculation.calculationBase,
          supplementaryPremium: supplementaryCalculation.premiumAmount,
          premiumRate: supplementaryCalculation.premiumRate,
          isAdjustment: !!originalRecordId,
          adjustmentReason,
          originalRecordId,
          createdBy
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              department: true,
              position: true
            }
          }
        }
      });

      // 更新年度累計記錄
      await tx.employeeAnnualBonus.update({
        where: { id: annualBonus.id },
        data: {
          totalBonusAmount: {
            increment: amount
          },
          supplementaryPremium: {
            increment: supplementaryCalculation.premiumAmount
          }
        }
      });

      return bonusRecord;
    });

    return NextResponse.json({
      success: true,
      data: result,
      supplementaryCalculation
    });

  } catch (error) {
    console.error('獎金記錄創建失敗:', error);
    return NextResponse.json(
      { success: false, error: '獎金記錄創建失敗' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, amount, adjustmentReason, createdBy } = body;

    if (!id || amount === undefined || !createdBy) {
      return NextResponse.json(
        { success: false, error: '缺少必要欄位' },
        { status: 400 }
      );
    }

    // 查詢原始記錄
    const originalRecord = await prisma.bonusRecord.findUnique({
      where: { id },
      include: {
        employee: {
          select: { baseSalary: true }
        },
        annualBonus: true
      }
    });

    if (!originalRecord) {
      return NextResponse.json(
        { success: false, error: '獎金記錄不存在' },
        { status: 404 }
      );
    }

    const amountDifference = amount - originalRecord.amount;

    // 重新計算補充保費 (使用調整後的累計金額)
    const newCumulativeBefore = originalRecord.cumulativeBonusBefore;
    const newCumulativeAfter = originalRecord.cumulativeBonusAfter + amountDifference;

    const supplementaryCalculation = calculateBonusSupplementaryPremium(
      originalRecord.insuredAmount,
      newCumulativeBefore,
      amount
    );

    const supplementaryDifference = supplementaryCalculation.premiumAmount - originalRecord.supplementaryPremium;

    // 事務處理
    const result = await prisma.$transaction(async (tx) => {
      // 更新原記錄
      const updatedRecord = await tx.bonusRecord.update({
        where: { id },
        data: {
          amount,
          cumulativeBonusAfter: newCumulativeAfter,
          calculationBase: supplementaryCalculation.calculationBase,
          supplementaryPremium: supplementaryCalculation.premiumAmount,
          adjustmentReason,
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              department: true,
              position: true
            }
          }
        }
      });

      // 更新年度累計
      await tx.employeeAnnualBonus.update({
        where: { id: originalRecord.annualBonusId },
        data: {
          totalBonusAmount: {
            increment: amountDifference
          },
          supplementaryPremium: {
            increment: supplementaryDifference
          }
        }
      });

      return updatedRecord;
    });

    return NextResponse.json({
      success: true,
      data: result,
      changes: {
        amountDifference,
        supplementaryDifference
      }
    });

  } catch (error) {
    console.error('獎金記錄更新失敗:', error);
    return NextResponse.json(
      { success: false, error: '獎金記錄更新失敗' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '缺少獎金記錄ID' },
        { status: 400 }
      );
    }

    // 查詢要刪除的記錄
    const recordToDelete = await prisma.bonusRecord.findUnique({
      where: { id: parseInt(id) },
      include: { annualBonus: true }
    });

    if (!recordToDelete) {
      return NextResponse.json(
        { success: false, error: '獎金記錄不存在' },
        { status: 404 }
      );
    }

    // 事務處理
    await prisma.$transaction(async (tx) => {
      // 刪除記錄
      await tx.bonusRecord.delete({
        where: { id: parseInt(id) }
      });

      // 更新年度累計 (減少對應金額)
      await tx.employeeAnnualBonus.update({
        where: { id: recordToDelete.annualBonusId },
        data: {
          totalBonusAmount: {
            decrement: recordToDelete.amount
          },
          supplementaryPremium: {
            decrement: recordToDelete.supplementaryPremium
          }
        }
      });
    });

    return NextResponse.json({
      success: true,
      message: '獎金記錄已刪除'
    });

  } catch (error) {
    console.error('獎金記錄刪除失敗:', error);
    return NextResponse.json(
      { success: false, error: '獎金記錄刪除失敗' },
      { status: 500 }
    );
  }
}
