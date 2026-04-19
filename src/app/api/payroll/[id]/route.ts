import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { buildSuccessPayload } from '@/lib/api-response';
import { validateCSRF } from '@/lib/csrf';
import { getStoredLaborLawConfig } from '@/lib/labor-law-config';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { calculatePayrollTotals } from '@/lib/payroll-calculator';
import { buildEmployeePayrollInfo } from '@/lib/payroll-processing';
import { getStoredSupplementaryPremiumSettings } from '@/lib/supplementary-premium-settings';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePayrollId(id: string) {
  const parsed = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

  if (!parsed.isValid || parsed.value === null) {
    return null;
  }

  return parsed.value;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/payroll/[id]');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const payrollId = parsePayrollId(id);

    if (!payrollId) {
      return NextResponse.json({ error: '無效的薪資記錄 ID' }, { status: 400 });
    }

    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: payrollId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            baseSalary: true,
            hourlyRate: true
          }
        }
      }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    // 檢查權限：一般員工只能查看自己的薪資記錄
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR' && 
        payrollRecord.employeeId !== decoded.employeeId) {
      return NextResponse.json({ error: '無權限查看此記錄' }, { status: 403 });
    }

    return NextResponse.json(buildSuccessPayload({ payrollRecord }));
  } catch (error) {
    console.error('獲取薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/payroll/[id]');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    // 只有管理員和HR可以更新薪資記錄
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { id } = await params;
    const payrollId = parsePayrollId(id);

    if (!payrollId) {
      return NextResponse.json({ error: '無效的薪資記錄 ID' }, { status: 400 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const regularHours = asNumber(body.regularHours);
    const overtimeHours = asNumber(body.overtimeHours);
    const basePay = asNumber(body.basePay);
    const overtimePay = asNumber(body.overtimePay);

    if (
      regularHours === undefined &&
      overtimeHours === undefined &&
      basePay === undefined &&
      overtimePay === undefined
    ) {
      return NextResponse.json({ error: '未提供可更新欄位' }, { status: 400 });
    }

    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: payrollId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            baseSalary: true,
            hourlyRate: true,
            hireDate: true,
            dependents: true,
            insuredBase: true,
            laborPensionSelfRate: true,
            employeeType: true,
            laborInsuranceActive: true,
            healthInsuranceActive: true
          }
        }
      }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    const resolvedBasePay = basePay ?? payrollRecord.basePay;
    const resolvedOvertimePay = overtimePay ?? payrollRecord.overtimePay;
    const existingTotalBonus = Math.max(0, payrollRecord.grossPay - payrollRecord.basePay - payrollRecord.overtimePay);
    const employeeInfo = await buildEmployeePayrollInfo(
      payrollRecord.employee,
      payrollRecord.payYear,
      payrollRecord.payMonth
    );
    const [supplementaryPremiumSettings, laborLawConfig] = await Promise.all([
      getStoredSupplementaryPremiumSettings(),
      getStoredLaborLawConfig(),
    ]);
    const totals = calculatePayrollTotals(
      employeeInfo,
      resolvedBasePay + resolvedOvertimePay,
      existingTotalBonus,
      supplementaryPremiumSettings,
      laborLawConfig
    );

    const updatedPayrollRecord = await prisma.payrollRecord.update({
      where: { id: payrollId },
      data: {
        ...(regularHours !== undefined && { regularHours }),
        ...(overtimeHours !== undefined && { overtimeHours }),
        ...(basePay !== undefined && { basePay: resolvedBasePay }),
        ...(overtimePay !== undefined && { overtimePay: resolvedOvertimePay }),
        grossPay: totals.grossPay,
        laborInsurance: totals.deductions.laborInsurance,
        healthInsurance: totals.deductions.healthInsurance,
        supplementaryInsurance: totals.deductions.supplementaryInsurance,
        laborPensionSelf: totals.deductions.laborPensionSelf,
        incomeTax: totals.deductions.incomeTax,
        totalDeductions: totals.totalDeductions,
        deductionDetails: {
          laborInsurance: totals.deductions.laborInsurance,
          healthInsurance: totals.deductions.healthInsurance,
          supplementaryInsurance: totals.deductions.supplementaryInsurance,
          laborPensionSelf: totals.deductions.laborPensionSelf,
          incomeTax: totals.deductions.incomeTax,
          other: totals.deductions.other
        },
        netPay: totals.netPay
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            baseSalary: true,
            hourlyRate: true
          }
        }
      }
    });

    return NextResponse.json(
      buildSuccessPayload({
        payrollRecord: updatedPayrollRecord,
        message: '薪資記錄更新成功'
      })
    );
  } catch (error) {
    console.error('更新薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/payroll/[id]');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    // 只有管理員可以刪除薪資記錄
    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { id } = await params;
    const payrollId = parsePayrollId(id);

    if (!payrollId) {
      return NextResponse.json({ error: '無效的薪資記錄 ID' }, { status: 400 });
    }

    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: payrollId }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    await prisma.payrollRecord.delete({
      where: { id: payrollId }
    });

    return NextResponse.json(
      buildSuccessPayload({
        message: '薪資記錄已刪除'
      })
    );
  } catch (error) {
    console.error('刪除薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
