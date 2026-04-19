import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { calculatePerfectAttendanceBonus } from '@/lib/perfect-attendance';
import { buildSuccessPayload } from '@/lib/api-response';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { getStoredLaborLawConfig } from '@/lib/labor-law-config';
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

function buildEmployeeSelect(includeExtended: boolean): Prisma.EmployeeSelect {
  const employeeModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'Employee');
  const fields = new Set((employeeModel?.fields ?? []).map(f => f.name));
  const base: Record<string, boolean> = {
    id: true,
    employeeId: true,
    name: true,
    department: true,
    position: true,
    baseSalary: true,
    hourlyRate: true
  };
  if (includeExtended) {
    if (fields.has('insuredBase')) base.insuredBase = true;
    if (fields.has('dependents')) base.dependents = true;
    if (fields.has('laborPensionSelfRate')) base.laborPensionSelfRate = true;
  }
  return base as Prisma.EmployeeSelect;
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/payroll');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const user = await getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    // 建立篩選條件
    const where: {
      employeeId?: number;
      payYear?: number;
      payMonth?: number;
    } = {};

    // 權限控制：員工可以查看自己的薪資記錄，管理員和HR可以查看所有記錄
    const isEmployee = user.role !== 'ADMIN' && user.role !== 'HR';
    if (isEmployee) {
      where.employeeId = user.employeeId;
    } else if (employeeId) {
      const parsedEmployeeId = parseIntegerQueryParam(employeeId, { min: 1, max: 99999999 });
      if (!parsedEmployeeId.isValid || parsedEmployeeId.value === null) {
        return NextResponse.json({ error: '員工ID格式無效' }, { status: 400 });
      }
      where.employeeId = parsedEmployeeId.value;
    }

    if (year) {
      const parsedYear = parseIntegerQueryParam(year, { min: 2000, max: 2100 });
      if (!parsedYear.isValid || parsedYear.value === null) {
        return NextResponse.json({ error: '年份格式無效' }, { status: 400 });
      }
      where.payYear = parsedYear.value;
    }

    if (month) {
      const parsedMonth = parseIntegerQueryParam(month, { min: 1, max: 12 });
      if (!parsedMonth.isValid || parsedMonth.value === null) {
        return NextResponse.json({ error: '月份格式無效' }, { status: 400 });
      }
      where.payMonth = parsedMonth.value;
    }

    const payrollRecords = await prisma.payrollRecord.findMany({
      where,
      include: {
        employee: {
          select: buildEmployeeSelect(isEmployee)
        }
      },
      orderBy: [
        { payYear: 'desc' },
        { payMonth: 'desc' },
        { employee: { name: 'asc' } }
      ]
    });

    return NextResponse.json(buildSuccessPayload({ payrollRecords }));
  } catch (error) {
    console.error('獲取薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/payroll');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以創建薪資記錄
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const employeeId = isPlainObject(body) ? asStringOrNumber(body.employeeId) : undefined;
    const payYear = isPlainObject(body) ? asStringOrNumber(body.payYear) : undefined;
    const payMonth = isPlainObject(body) ? asStringOrNumber(body.payMonth) : undefined;

    // 驗證必填欄位
    if (!employeeId || !payYear || !payMonth) {
      return NextResponse.json({ error: '員工ID、年份和月份為必填' }, { status: 400 });
    }

    const employeeIdNumber = parsePayrollInteger(employeeId, { min: 1, max: 99999999 });
    const payYearNumber = parsePayrollInteger(payYear, { min: 2000, max: 2100 });
    const payMonthNumber = parsePayrollInteger(payMonth, { min: 1, max: 12 });

    if (employeeIdNumber === null) {
      return NextResponse.json({ error: '員工ID格式無效' }, { status: 400 });
    }

    if (payYearNumber === null) {
      return NextResponse.json({ error: '年份格式無效' }, { status: 400 });
    }

    if (payMonthNumber === null) {
      return NextResponse.json({ error: '月份格式無效' }, { status: 400 });
    }

    // 檢查是否已存在該月份的薪資記錄
    const existingRecord = await prisma.payrollRecord.findFirst({
      where: {
        employeeId: employeeIdNumber,
        payYear: payYearNumber,
        payMonth: payMonthNumber
      }
    });

    if (existingRecord) {
      return NextResponse.json({ error: '該月份的薪資記錄已存在' }, { status: 400 });
    }

    // 獲取員工資訊
    const employee = await prisma.employee.findUnique({
      where: { id: employeeIdNumber }
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到員工資訊' }, { status: 404 });
    }

    const [holidayDates, supplementaryPremiumSettings, laborLawConfig] = await Promise.all([
      getPayrollHolidayDates(payYearNumber, payMonthNumber),
      getStoredSupplementaryPremiumSettings(),
      getStoredLaborLawConfig(),
    ]);
    const {
      payrollResult,
      validation,
      bonuses,
      totals,
    } = await computePayrollForEmployee(employee, payYearNumber, payMonthNumber, {
      holidayDates,
      includeBonus: true,
      supplementaryPremiumSettings,
      laborLawConfig,
    });

    if (!validation.isValid) {
      return NextResponse.json(
        { error: `薪資計算驗證失敗: ${validation.errors.join(', ')}` },
        { status: 400 }
      );
    }

    // 保留全勤獎金檢查作為記錄提醒，不改變統一後的薪資計算邏輯
    try {
      const paResult = await calculatePerfectAttendanceBonus(
        employee.id,
        payYearNumber,
        payMonthNumber
      );
      if (paResult.eligible) {
        console.log(`✅ 全勤獎金檢查: ${employee.name} - ${paResult.actualAmount} 元 (${paResult.details})`);
      }
    } catch (paError) {
      console.warn('計算全勤獎金失敗:', paError);
    }

    const disputeAdjustments = await getPendingApprovedPayrollDisputeAdjustments(
      employee.id,
      payYearNumber,
      payMonthNumber
    );

    const payload = buildPayrollRecordData(
      employee,
      payYearNumber,
      payMonthNumber,
      payrollResult,
      totals,
      bonuses,
      disputeAdjustments
    ) as unknown as Prisma.PayrollRecordUncheckedCreateInput;

    const payrollRecord = await prisma.$transaction(async (tx) => {
      const createdRecord = await tx.payrollRecord.create({
        data: payload,
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
            createdBy: user.employeeId,
          }
        });
      }

      return createdRecord;
    });

    return NextResponse.json(
      buildSuccessPayload({
        payrollRecord,
        message: '薪資記錄創建成功'
      })
    );
  } catch (error) {
    console.error('創建薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
