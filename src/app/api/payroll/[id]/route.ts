import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { buildSuccessPayload } from '@/lib/api-response';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
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
    const regularHours = isPlainObject(body) ? asNumber(body.regularHours) : undefined;
    const overtimeHours = isPlainObject(body) ? asNumber(body.overtimeHours) : undefined;
    const basePay = isPlainObject(body) ? asNumber(body.basePay) : undefined;
    const overtimePay = isPlainObject(body) ? asNumber(body.overtimePay) : undefined;

    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: payrollId }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    // 計算新的總薪資
    const newGrossPay = (basePay || payrollRecord.basePay) + (overtimePay || payrollRecord.overtimePay);
    const newNetPay = newGrossPay; // 簡化計算

    const updatedPayrollRecord = await prisma.payrollRecord.update({
      where: { id: payrollId },
      data: {
        ...(regularHours !== undefined && { regularHours }),
        ...(overtimeHours !== undefined && { overtimeHours }),
        ...(basePay !== undefined && { basePay }),
        ...(overtimePay !== undefined && { overtimePay }),
        grossPay: newGrossPay,
        netPay: newNetPay
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
