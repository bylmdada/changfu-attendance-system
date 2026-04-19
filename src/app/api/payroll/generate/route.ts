import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getStoredLaborLawConfig } from '@/lib/labor-law-config';
import { parseIntegerQueryParam } from '@/lib/query-params';
import {
  buildPayrollRecordData,
  computePayrollForEmployee,
  getPendingApprovedPayrollDisputeAdjustments,
  getPayrollHolidayDates,
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

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/payroll/generate');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
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

    // 建立員工查詢條件（支援部門篩選）
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

    const results = [];
    const errors = [];

    for (const employee of employees) {
      try {
        // 檢查是否已存在該月份的薪資記錄
        const existingRecord = await prisma.payrollRecord.findFirst({
          where: {
            employeeId: employee.id,
            payYear: year,
            payMonth: month
          }
        });

        if (existingRecord) {
          errors.push(`員工 ${employee.name} (${employee.employeeId}) 的 ${year}年${month}月 薪資記錄已存在`);
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

        if (!validation.isValid) {
          errors.push(`員工 ${employee.name} 薪資計算驗證失敗: ${validation.errors.join(', ')}`);
          continue;
        }

        const disputeAdjustments = await getPendingApprovedPayrollDisputeAdjustments(
          employee.id,
          year,
          month
        );

        // 創建薪資記錄（獎金與待套用異議調整已合併到最終金額）
        const payrollRecord = await prisma.$transaction(async (tx) => {
          const createdRecord = await tx.payrollRecord.create({
            data: buildPayrollRecordData(
              employee,
              year,
              month,
              payrollResult,
              totals,
              bonuses,
              disputeAdjustments
            ) as unknown as Prisma.PayrollRecordUncheckedCreateInput,
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

          for (const adjustment of disputeAdjustments) {
            await tx.payrollAdjustment.create({
              data: {
                payrollId: createdRecord.id,
                disputeId: adjustment.disputeId,
                type: adjustment.type,
                category: adjustment.category,
                description: adjustment.description,
                amount: adjustment.amount,
                originalYear: adjustment.originalYear,
                originalMonth: adjustment.originalMonth,
                createdBy: user.employeeId
              }
            });
          }

          return createdRecord;
        });

        results.push(payrollRecord);
      } catch (error) {
        console.error(`為員工 ${employee.name} 生成薪資記錄失敗:`, error);
        errors.push(`員工 ${employee.name} (${employee.employeeId}) 薪資記錄生成失敗`);
      }
    }

    if (results.length === 0 && errors.length > 0) {
      return NextResponse.json({
        error: errors.length === 1 ? errors[0] : '批量生成薪資記錄失敗，請檢查錯誤明細後再試',
        errors,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `成功生成 ${results.length} 筆薪資記錄`,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('批量生成薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
