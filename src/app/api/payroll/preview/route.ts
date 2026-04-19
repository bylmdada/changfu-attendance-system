import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getStoredLaborLawConfig } from '@/lib/labor-law-config';
import { parseIntegerQueryParam } from '@/lib/query-params';
import {
  computePayrollForEmployee,
  getPendingApprovedPayrollDisputeAdjustments,
  getPayrollHolidayDates,
  summarizePayrollDisputeAdjustments,
} from '@/lib/payroll-processing';
import { getStoredSupplementaryPremiumSettings } from '@/lib/supplementary-premium-settings';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function parsePayrollInteger(value: string | number, options: { min: number; max: number }) {
  const parsed = parseIntegerQueryParam(String(value), options);
  return parsed.isValid ? parsed.value : null;
}

function parseEmployeeIds(values: unknown[] | undefined): number[] | null {
  if (!values) {
    return [];
  }

  const parsedIds = values.map(value =>
    typeof value === 'string' || typeof value === 'number'
      ? parsePayrollInteger(value, { min: 1, max: 99999999 })
      : null
  );

  return parsedIds.every((value): value is number => value !== null) ? parsedIds : null;
}

// 預覽薪資計算（不儲存）
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/payroll/preview');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const payYear = isPlainObject(body) ? asStringOrNumber(body.payYear) : undefined;
    const payMonth = isPlainObject(body) ? asStringOrNumber(body.payMonth) : undefined;
    const employeeIds = isPlainObject(body) && Array.isArray(body.employeeIds) ? body.employeeIds : undefined;
    const department = isPlainObject(body) && typeof body.department === 'string' ? body.department : undefined;
    const includeBonus = isPlainObject(body) && typeof body.includeBonus === 'boolean' ? body.includeBonus : true;

    if (!payYear || !payMonth) {
      return NextResponse.json({ error: '年份和月份為必填' }, { status: 400 });
    }

    const year = parsePayrollInteger(payYear, { min: 2000, max: 2100 });
    if (year === null) {
      return NextResponse.json({ error: '年份格式無效' }, { status: 400 });
    }

    const month = parsePayrollInteger(payMonth, { min: 1, max: 12 });
    if (month === null) {
      return NextResponse.json({ error: '月份格式無效' }, { status: 400 });
    }

    const parsedEmployeeIds = parseEmployeeIds(employeeIds);
    if (parsedEmployeeIds === null) {
      return NextResponse.json({ error: '員工ID清單格式無效' }, { status: 400 });
    }

    // 取得國定假日
    const [holidayDates, supplementaryPremiumSettings, laborLawConfig] = await Promise.all([
      getPayrollHolidayDates(year, month),
      getStoredSupplementaryPremiumSettings(),
      getStoredLaborLawConfig(),
    ]);

    // 建立員工查詢條件
    interface EmployeeWhereClause {
      isActive: boolean;
      id?: { in: number[] };
      department?: string;
    }
    
    const whereClause: EmployeeWhereClause = { isActive: true };
    
    if (parsedEmployeeIds.length > 0) {
      whereClause.id = { in: parsedEmployeeIds };
    }
    if (department) {
      whereClause.department = department;
    }

    const employees = await prisma.employee.findMany({
      where: whereClause
    });

    if (employees.length === 0) {
      return NextResponse.json({ error: '找不到符合條件的員工' }, { status: 400 });
    }

    const previews = [];
    const existingRecords = [];

    for (const employee of employees) {
      // 檢查是否已存在記錄
      const existingRecord = await prisma.payrollRecord.findFirst({
        where: {
          employeeId: employee.id,
          payYear: year,
          payMonth: month
        }
      });

      if (existingRecord) {
        existingRecords.push({
          employeeId: employee.employeeId,
          employeeName: employee.name,
          department: employee.department,
          existing: true
        });
        continue;
      }

      const {
        payrollResult,
        validation,
        bonuses,
        totals,
      } = await computePayrollForEmployee(employee, year, month, {
        holidayDates,
        includeBonus,
        supplementaryPremiumSettings,
        laborLawConfig,
      });
      const disputeAdjustments = await getPendingApprovedPayrollDisputeAdjustments(employee.id, year, month);
      const disputeAdjustmentSummary = summarizePayrollDisputeAdjustments(disputeAdjustments);

      previews.push({
        employeeId: employee.employeeId,
        employeeName: employee.name,
        department: employee.department,
        position: employee.position,
        baseSalary: employee.baseSalary,
        regularHours: payrollResult.regularHours,
        overtimeHours: payrollResult.totalOvertimeHours,
        basePay: payrollResult.basePay,
        overtimePay: payrollResult.totalOvertimePay,
        festivalBonus: bonuses.festivalBonus,
        yearEndBonus: bonuses.yearEndBonus,
        totalBonus: bonuses.totalBonus,
        grossPay: totals.grossPay + disputeAdjustmentSummary.supplementTotal,
        deductions: totals.deductions,
        totalDeductions: totals.totalDeductions + disputeAdjustmentSummary.deductionTotal,
        netPay: totals.netPay + disputeAdjustmentSummary.netAdjustment,
        disputeAdjustmentTotal: disputeAdjustmentSummary.netAdjustment,
        disputeAdjustments: disputeAdjustments.map(adjustment => ({
          type: adjustment.type,
          description: adjustment.description,
          amount: adjustment.amount,
        })),
        isValid: validation.isValid,
        errors: validation.errors
      });
    }

    // 統計資訊
    const summary = {
      totalEmployees: employees.length,
      previewCount: previews.length,
      existingCount: existingRecords.length,
      totalGrossPay: previews.reduce((sum, p) => sum + p.grossPay, 0),
      totalNetPay: previews.reduce((sum, p) => sum + p.netPay, 0),
      totalBonus: previews.reduce((sum, p) => sum + p.totalBonus, 0),
      totalDeductions: previews.reduce((sum, p) => sum + p.totalDeductions, 0)
    };

    return NextResponse.json({
      success: true,
      year,
      month,
      summary,
      previews,
      existingRecords
    });
  } catch (error) {
    console.error('預覽薪資計算失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
