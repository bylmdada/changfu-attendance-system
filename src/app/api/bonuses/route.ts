import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { 
  calculateBonusSupplementaryPremium, 
  getInsuredAmount 
} from '@/lib/tax-calculator';
import {
  getBonusSupplementaryPremiumContext,
  getStoredSupplementaryPremiumSettings,
} from '@/lib/supplementary-premium-settings';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOptionalNonEmptyString(rawValue: unknown, fieldName: string) {
  if (rawValue === undefined) {
    return { isValid: true as const, value: undefined };
  }

  if (rawValue === null) {
    return { isValid: true as const, value: null };
  }

  if (typeof rawValue !== 'string') {
    return { isValid: false as const, error: `${fieldName}格式無效` };
  }

  const trimmedValue = rawValue.trim();
  return { isValid: true as const, value: trimmedValue === '' ? null : trimmedValue };
}

function parseRequiredPositiveInteger(rawValue: unknown, fieldName: string) {
  const normalized = typeof rawValue === 'number'
    ? String(rawValue)
    : typeof rawValue === 'string'
      ? rawValue
      : null;

  const parsed = parseIntegerQueryParam(normalized, { min: 1 });

  if (!parsed.isValid || parsed.value === null) {
    return { isValid: false as const, error: `${fieldName}格式無效` };
  }

  return { isValid: true as const, value: parsed.value };
}

function parseOptionalPositiveInteger(rawValue: string | null, fieldName: string) {
  if (rawValue === null) {
    return { isPresent: false as const };
  }

  const parsed = parseIntegerQueryParam(rawValue, { min: 1 });

  if (!parsed.isValid || parsed.value === null) {
    return { isPresent: true as const, isValid: false as const, error: `${fieldName}格式無效` };
  }

  return { isPresent: true as const, isValid: true as const, value: parsed.value };
}

function parseFiniteNumberValue(rawValue: unknown, fieldName: string) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { isValid: false as const, error: `${fieldName}格式無效` };
  }

  const value = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number(rawValue)
      : NaN;

  if (!Number.isFinite(value)) {
    return { isValid: false as const, error: `${fieldName}格式無效` };
  }

  return { isValid: true as const, value };
}

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
    const user = await getUserFromRequest(request);
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
    const bonusType = searchParams.get('bonusType');

    const parsedEmployeeId = parseOptionalPositiveInteger(employeeId, 'employeeId');
    if (parsedEmployeeId.isPresent && !parsedEmployeeId.isValid) {
      return NextResponse.json({ error: parsedEmployeeId.error }, { status: 400 });
    }

    const parsedYear = parseOptionalPositiveInteger(year, 'year');
    if (parsedYear.isPresent && !parsedYear.isValid) {
      return NextResponse.json({ error: parsedYear.error }, { status: 400 });
    }

    const parsedMonth = parseOptionalPositiveInteger(month, 'month');
    if (parsedMonth.isPresent && !parsedMonth.isValid) {
      return NextResponse.json({ error: parsedMonth.error }, { status: 400 });
    }

    // 查詢獎金記錄
    const whereClause: Record<string, string | number> = {};
    
    if (parsedEmployeeId.isPresent && parsedEmployeeId.isValid) {
      whereClause.employeeId = parsedEmployeeId.value;
    }
    
    if (parsedYear.isPresent && parsedYear.isValid) {
      whereClause.payrollYear = parsedYear.value;
    }
    
    if (parsedMonth.isPresent && parsedMonth.isValid) {
      whereClause.payrollMonth = parsedMonth.value;
    }

    if (typeof bonusType === 'string' && bonusType.trim() !== '') {
      whereClause.bonusType = bonusType.trim();
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
    if (parsedEmployeeId.isPresent && parsedEmployeeId.isValid && parsedYear.isPresent && parsedYear.isValid) {
      annualSummary = await prisma.employeeAnnualBonus.findUnique({
        where: {
          employeeId_year: {
            employeeId: parsedEmployeeId.value,
            year: parsedYear.value
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
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 權限檢查
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    if (!user.employeeId) {
      return NextResponse.json({ error: '找不到操作人員員工資料' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    if (!isPlainObject(parsedBody.data)) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const body = parsedBody.data;
    const {
      employeeId,
      bonusType,
      bonusTypeName,
      amount,
      payrollYear,
      payrollMonth,
      adjustmentReason,
      originalRecordId
    } = body;

    // 驗證必要欄位
    if (employeeId === undefined || bonusType === undefined || amount === undefined || payrollYear === undefined || payrollMonth === undefined) {
      return NextResponse.json(
        { success: false, error: '缺少必要欄位' },
        { status: 400 }
      );
    }

    if (typeof bonusType !== 'string' || bonusType.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'bonusType格式無效' },
        { status: 400 }
      );
    }

    const parsedEmployeeId = parseRequiredPositiveInteger(employeeId, 'employeeId');
    if (!parsedEmployeeId.isValid) {
      return NextResponse.json({ success: false, error: parsedEmployeeId.error }, { status: 400 });
    }

    const parsedPayrollYear = parseRequiredPositiveInteger(payrollYear, 'payrollYear');
    if (!parsedPayrollYear.isValid) {
      return NextResponse.json({ success: false, error: parsedPayrollYear.error }, { status: 400 });
    }

    const parsedPayrollMonth = parseRequiredPositiveInteger(payrollMonth, 'payrollMonth');
    if (!parsedPayrollMonth.isValid) {
      return NextResponse.json({ success: false, error: parsedPayrollMonth.error }, { status: 400 });
    }

    const parsedAmount = parseFiniteNumberValue(amount, 'amount');
    if (!parsedAmount.isValid) {
      return NextResponse.json({ success: false, error: parsedAmount.error }, { status: 400 });
    }

    const parsedOriginalRecordId = originalRecordId === undefined || originalRecordId === null || originalRecordId === ''
      ? null
      : parseRequiredPositiveInteger(originalRecordId, 'originalRecordId');
    if (parsedOriginalRecordId && !parsedOriginalRecordId.isValid) {
      return NextResponse.json({ success: false, error: parsedOriginalRecordId.error }, { status: 400 });
    }

    const normalizedBonusTypeNameResult = normalizeOptionalNonEmptyString(bonusTypeName, 'bonusTypeName');
    if (!normalizedBonusTypeNameResult.isValid) {
      return NextResponse.json({ success: false, error: normalizedBonusTypeNameResult.error }, { status: 400 });
    }

    const normalizedAdjustmentReasonResult = normalizeOptionalNonEmptyString(adjustmentReason, 'adjustmentReason');
    if (!normalizedAdjustmentReasonResult.isValid) {
      return NextResponse.json({ success: false, error: normalizedAdjustmentReasonResult.error }, { status: 400 });
    }

    const normalizedBonusType = bonusType.trim();
    const normalizedBonusTypeName = typeof normalizedBonusTypeNameResult.value === 'string'
      ? normalizedBonusTypeNameResult.value
      : normalizedBonusType;
    const normalizedAdjustmentReason = normalizedAdjustmentReasonResult.value;
    const employeeIdValue = parsedEmployeeId.value;
    const payrollYearValue = parsedPayrollYear.value;
    const payrollMonthValue = parsedPayrollMonth.value;
    const amountValue = parsedAmount.value;
    const originalRecordIdValue = parsedOriginalRecordId?.value ?? null;

    // 檢查員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: employeeIdValue },
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

    // 計算健保投保金額
    const insuredAmount = getInsuredAmount(employee.baseSalary);

    const supplementarySettings = await getStoredSupplementaryPremiumSettings();

    // 開始事務處理
    const result = await prisma.$transaction(async (tx) => {
      const annualBonus = await tx.employeeAnnualBonus.upsert({
        where: {
          employeeId_year: {
            employeeId: employeeIdValue,
            year: payrollYearValue
          }
        },
        create: {
          employeeId: employeeIdValue,
          year: payrollYearValue,
          totalBonusAmount: 0,
          supplementaryPremium: 0
        },
        update: {}
      });

      const { currentPeriodBonusTotal, currentYearPremiumTotal } = await getBonusSupplementaryPremiumContext({
        employeeId: employeeIdValue,
        payrollYear: payrollYearValue,
        payrollMonth: payrollMonthValue,
        settings: supplementarySettings,
        db: tx,
      });
      const supplementaryCalculation = calculateBonusSupplementaryPremium(
        insuredAmount,
        currentPeriodBonusTotal,
        amountValue,
        supplementarySettings,
        currentYearPremiumTotal
      );

      // 創建獎金記錄
      const bonusRecord = await tx.bonusRecord.create({
        data: {
          employeeId: employeeIdValue,
          annualBonusId: annualBonus.id,
          bonusType: normalizedBonusType,
          bonusTypeName: normalizedBonusTypeName,
          amount: amountValue,
          payrollYear: payrollYearValue,
          payrollMonth: payrollMonthValue,
          insuredAmount,
          exemptThreshold: supplementaryCalculation.exemptThreshold,
          cumulativeBonusBefore: supplementaryCalculation.currentYearBonusTotal,
          cumulativeBonusAfter: supplementaryCalculation.currentYearBonusTotal + amountValue,
          calculationBase: supplementaryCalculation.calculationBase,
          supplementaryPremium: supplementaryCalculation.premiumAmount,
          premiumRate: supplementaryCalculation.premiumRate,
          isAdjustment: originalRecordIdValue !== null,
          adjustmentReason: normalizedAdjustmentReason,
          originalRecordId: originalRecordIdValue,
          createdBy: user.employeeId
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
            increment: amountValue
          },
          supplementaryPremium: {
            increment: supplementaryCalculation.premiumAmount
          }
        }
      });

      return { bonusRecord, supplementaryCalculation };
    });

    return NextResponse.json({
      success: true,
      data: result.bonusRecord,
      supplementaryCalculation: result.supplementaryCalculation
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
    const rateLimitResult = await checkRateLimit(request, '/api/bonuses');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    if (!isPlainObject(parsedBody.data)) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const body = parsedBody.data;
    const { id, amount, adjustmentReason } = body;

    if (!id || amount === undefined) {
      return NextResponse.json(
        { success: false, error: '缺少必要欄位' },
        { status: 400 }
      );
    }

    const parsedId = parseRequiredPositiveInteger(id, '獎金記錄ID');
    if (!parsedId.isValid) {
      return NextResponse.json(
        { success: false, error: parsedId.error },
        { status: 400 }
      );
    }

    const parsedAmount = parseFiniteNumberValue(amount, 'amount');
    if (!parsedAmount.isValid) {
      return NextResponse.json(
        { success: false, error: parsedAmount.error },
        { status: 400 }
      );
    }

    const normalizedAdjustmentReasonResult = normalizeOptionalNonEmptyString(adjustmentReason, 'adjustmentReason');
    if (!normalizedAdjustmentReasonResult.isValid) {
      return NextResponse.json(
        { success: false, error: normalizedAdjustmentReasonResult.error },
        { status: 400 }
      );
    }

    const recordId = parsedId.value;
    const amountValue = parsedAmount.value;
    const normalizedAdjustmentReason = normalizedAdjustmentReasonResult.value;

    // 查詢原始記錄
    const originalRecord = await prisma.bonusRecord.findUnique({
      where: { id: recordId },
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

    const amountDifference = amountValue - originalRecord.amount;

    const supplementarySettings = await getStoredSupplementaryPremiumSettings();

    // 事務處理
    const result = await prisma.$transaction(async (tx) => {
      const { currentPeriodBonusTotal, currentYearPremiumTotal } = await getBonusSupplementaryPremiumContext({
        employeeId: originalRecord.employeeId,
        payrollYear: originalRecord.payrollYear,
        payrollMonth: originalRecord.payrollMonth,
        settings: supplementarySettings,
        excludeRecordId: recordId,
        db: tx,
      });
      const supplementaryCalculation = calculateBonusSupplementaryPremium(
        originalRecord.insuredAmount,
        currentPeriodBonusTotal,
        amountValue,
        supplementarySettings,
        currentYearPremiumTotal
      );
      const newCumulativeAfter = currentPeriodBonusTotal + amountValue;
      const supplementaryDifference = supplementaryCalculation.premiumAmount - originalRecord.supplementaryPremium;

      // 更新原記錄
      const updatedRecord = await tx.bonusRecord.update({
        where: { id: recordId },
        data: {
          amount: amountValue,
          cumulativeBonusBefore: currentPeriodBonusTotal,
          cumulativeBonusAfter: newCumulativeAfter,
          calculationBase: supplementaryCalculation.calculationBase,
          supplementaryPremium: supplementaryCalculation.premiumAmount,
          adjustmentReason: normalizedAdjustmentReason,
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

      return {
        updatedRecord,
        amountDifference,
        supplementaryDifference,
      };
    });

    return NextResponse.json({
      success: true,
      data: result.updatedRecord,
      changes: {
        amountDifference: result.amountDifference,
        supplementaryDifference: result.supplementaryDifference
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
    const rateLimitResult = await checkRateLimit(request, '/api/bonuses');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '缺少獎金記錄ID' },
        { status: 400 }
      );
    }

    const parsedId = parseIntegerQueryParam(id, { min: 1 });
    if (!parsedId.isValid || parsedId.value === null) {
      return NextResponse.json(
        { success: false, error: '獎金記錄ID格式無效' },
        { status: 400 }
      );
    }

    const recordId = parsedId.value;

    // 查詢要刪除的記錄
    const recordToDelete = await prisma.bonusRecord.findUnique({
      where: { id: recordId },
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
        where: { id: recordId }
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
