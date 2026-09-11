import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { buildSuccessPayload } from '@/lib/api-response';
import {
  getStoredIncomeTaxManagementSettings,
  resolvePayrollIncomeTaxDisplayAmounts,
} from '@/lib/income-tax-settings';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { buildPayslipHourSummary } from '@/lib/payroll-payslip-hours';

interface StoredBonusDetail {
  bonusType?: string;
  bonusTypeName?: string;
  amount?: number;
  source?: string;
}

interface StoredAttendancePenaltyDetail {
  workDate?: string;
  status?: string;
  deductionHours?: number;
  hourlyWage?: number;
  amount?: number;
  formula?: string;
}

interface StoredAttendancePenaltySummary {
  totalAmount: number;
  details: Array<{
    workDate: string;
    status: string;
    deductionHours: number;
    hourlyWage: number;
    amount: number;
    formula: string;
  }>;
}

function parsePayrollJsonField<T>(value: unknown, fallback: T): T {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

function getStoredBonusDetails(payrollRecord: {
  deductionDetails?: unknown;
}) {
  const deductionDetails = parsePayrollJsonField<Record<string, unknown>>(payrollRecord.deductionDetails, {});
  const rawBonusDetails = Array.isArray(deductionDetails.bonusDetails)
    ? deductionDetails.bonusDetails
    : [];
  const bonusSupplementaryInsurance = typeof deductionDetails.bonusSupplementaryInsurance === 'number'
    ? deductionDetails.bonusSupplementaryInsurance
    : 0;

  const bonusDetails = rawBonusDetails
    .filter((detail): detail is StoredBonusDetail =>
      typeof detail === 'object' && detail !== null
    )
    .map(detail => ({
      bonusType: typeof detail.bonusType === 'string' ? detail.bonusType : 'OTHER',
      bonusTypeName:
        typeof detail.bonusTypeName === 'string' && detail.bonusTypeName.trim() !== ''
          ? detail.bonusTypeName
          : '獎金',
      amount: typeof detail.amount === 'number' ? detail.amount : 0,
    }))
    .filter(detail => detail.amount !== 0);

  return {
    bonusDetails,
    bonusSupplementaryInsurance,
  };
}

function getStoredAttendancePenalty(payrollRecord: {
  deductionDetails?: unknown;
}): StoredAttendancePenaltySummary {
  const deductionDetails = parsePayrollJsonField<Record<string, unknown>>(payrollRecord.deductionDetails, {});
  const rawPenalty = deductionDetails.attendancePenalty;

  if (typeof rawPenalty !== 'object' || rawPenalty === null) {
    return { totalAmount: 0, details: [] };
  }

  const penalty = rawPenalty as { totalAmount?: unknown; details?: unknown };
  const details = Array.isArray(penalty.details)
    ? penalty.details
        .filter((detail): detail is StoredAttendancePenaltyDetail =>
          typeof detail === 'object' && detail !== null
        )
        .map(detail => ({
          workDate: typeof detail.workDate === 'string' ? detail.workDate : '',
          status: typeof detail.status === 'string' ? detail.status : '考勤異常',
          deductionHours: typeof detail.deductionHours === 'number' ? detail.deductionHours : 0,
          hourlyWage: typeof detail.hourlyWage === 'number' ? detail.hourlyWage : 0,
          amount: typeof detail.amount === 'number' ? detail.amount : 0,
          formula: typeof detail.formula === 'string' ? detail.formula : '',
        }))
        .filter(detail => detail.amount > 0)
    : [];

  const totalAmount = typeof penalty.totalAmount === 'number'
    ? penalty.totalAmount
    : details.reduce((sum, detail) => sum + detail.amount, 0);

  return { totalAmount, details };
}

function parsePayrollId(payrollId: string) {
  const parsed = parseIntegerQueryParam(payrollId, { min: 1, max: 99999999 });
  return parsed.isValid ? parsed.value : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const payrollId = searchParams.get('payrollId');

    if (!payrollId) {
      return NextResponse.json({ error: '薪資記錄ID為必填' }, { status: 400 });
    }

    const parsedPayrollId = parsePayrollId(payrollId);
    if (parsedPayrollId === null) {
      return NextResponse.json({ error: '薪資記錄ID格式無效' }, { status: 400 });
    }

    // 獲取薪資記錄 - 先簡化查詢
    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: parsedPayrollId },
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
            hireDate: true
          }
        },
        adjustments: {
          select: {
            id: true,
            type: true,
            description: true,
            amount: true
          },
          orderBy: { id: 'asc' }
        },
      }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    // 權限檢查：員工只能查看自己的薪資條
    if (user.role !== 'ADMIN' && user.role !== 'HR' &&
        payrollRecord.employeeId !== user.employeeId) {
      return NextResponse.json({ error: '無權限查看此薪資條' }, { status: 403 });
    }

    const incomeTaxSettings = await getStoredIncomeTaxManagementSettings();
    const displayAmounts = resolvePayrollIncomeTaxDisplayAmounts(
      {
        incomeTax: payrollRecord.incomeTax,
        totalDeductions: payrollRecord.totalDeductions,
        netPay: payrollRecord.netPay,
      },
      incomeTaxSettings
    );
    const { bonusDetails, bonusSupplementaryInsurance } = getStoredBonusDetails(payrollRecord);
    const attendancePenalty = getStoredAttendancePenalty(payrollRecord);

    // 使用基本薪資數據創建薪資條
    const earnings = [
      {
        code: 'BASE_SALARY',
        name: '基本薪資',
        amount: payrollRecord.basePay,
        quantity: 1,
        unitPrice: payrollRecord.basePay,
        description: '本薪'
      }
    ];

    if (payrollRecord.overtimePay > 0) {
      earnings.push({
        code: 'OVERTIME_PAY',
        name: '加班費',
        amount: payrollRecord.overtimePay,
        quantity: payrollRecord.overtimeHours,
        unitPrice: payrollRecord.overtimePay / payrollRecord.overtimeHours,
        description: '加班時數薪資'
      });
    }

    for (const bonusDetail of bonusDetails) {
      earnings.push({
        code: `BONUS_${bonusDetail.bonusType}`,
        name: bonusDetail.bonusTypeName,
        amount: bonusDetail.amount,
        quantity: 1,
        unitPrice: bonusDetail.amount,
        description: '獎金明細'
      });
    }

    for (const adjustment of payrollRecord.adjustments) {
      if (adjustment.type !== 'SUPPLEMENT') {
        continue;
      }

      earnings.push({
        code: `PAYROLL_ADJUSTMENT_${adjustment.id}`,
        name: '薪資異議補發',
        amount: adjustment.amount,
        quantity: 1,
        unitPrice: adjustment.amount,
        description: adjustment.description
      });
    }

    const deductions = [
      {
        code: 'LABOR_INSURANCE',
        name: '勞工保險',
        amount: payrollRecord.laborInsurance,
        quantity: 1,
        unitPrice: payrollRecord.laborInsurance,
        description: '勞保費'
      },
      {
        code: 'HEALTH_INSURANCE',
        name: '健康保險',
        amount: payrollRecord.healthInsurance,
        quantity: 1,
        unitPrice: payrollRecord.healthInsurance,
        description: '健保費'
      }
    ];

    const salarySupplementaryInsurance = Math.max(
      0,
      payrollRecord.supplementaryInsurance - bonusSupplementaryInsurance
    );

    if (salarySupplementaryInsurance > 0) {
      deductions.push({
        code: 'SUPPLEMENTARY_INSURANCE',
        name: '補充保費',
        amount: salarySupplementaryInsurance,
        quantity: 1,
        unitPrice: salarySupplementaryInsurance,
        description: '薪資補充保費'
      });
    }

    if (bonusSupplementaryInsurance > 0) {
      deductions.push({
        code: 'BONUS_SUPPLEMENTARY_INSURANCE',
        name: '獎金補充保費',
        amount: bonusSupplementaryInsurance,
        quantity: 1,
        unitPrice: bonusSupplementaryInsurance,
        description: '獎金發放補充保費'
      });
    }

    if (displayAmounts.incomeTax > 0) {
      deductions.push({
        code: 'INCOME_TAX',
        name: '所得稅',
        amount: displayAmounts.incomeTax,
        quantity: 1,
        unitPrice: displayAmounts.incomeTax,
        description: '代扣所得稅'
      });
    }

    if (attendancePenalty.totalAmount > 0) {
      deductions.push({
        code: 'ATTENDANCE_SALARY_DEDUCTION',
        name: '考勤扣薪',
        amount: attendancePenalty.totalAmount,
        quantity: attendancePenalty.details.reduce((sum, detail) => sum + detail.deductionHours, 0),
        unitPrice: attendancePenalty.details[0]?.hourlyWage || 0,
        description: attendancePenalty.details
          .map(detail => `${detail.workDate} ${detail.status}：${detail.formula}`)
          .join('；')
      });
    }

    for (const adjustment of payrollRecord.adjustments) {
      if (adjustment.type !== 'DEDUCTION') {
        continue;
      }

      deductions.push({
        code: `PAYROLL_ADJUSTMENT_${adjustment.id}`,
        name: '薪資異議扣除',
        amount: adjustment.amount,
        quantity: 1,
        unitPrice: adjustment.amount,
        description: adjustment.description
      });
    }

    const hourSummary = await buildPayslipHourSummary(payrollRecord);

    // 生成薪資條數據
    const payslip = {
      employee: {
        employeeId: payrollRecord.employee.employeeId,
        name: payrollRecord.employee.name,
        department: payrollRecord.employee.department,
        position: payrollRecord.employee.position,
        hireDate: payrollRecord.employee.hireDate,
      },
      period: {
        year: payrollRecord.payYear,
        month: payrollRecord.payMonth,
        monthName: `${payrollRecord.payYear}年${payrollRecord.payMonth}月`
      },
      workHours: {
        regular: payrollRecord.regularHours,
        overtime: payrollRecord.overtimeHours,
        total: payrollRecord.regularHours + payrollRecord.overtimeHours,
        ...hourSummary,
      },
      earnings: earnings,
      deductions: deductions,
      summary: {
        totalEarnings: earnings.reduce((sum: number, item: {amount: number}) => sum + item.amount, 0),
        totalDeductions: deductions.reduce((sum: number, item: {amount: number}) => sum + item.amount, 0),
        netPay: displayAmounts.netPay
      },
      generatedAt: new Date().toISOString(),
      companyInfo: {
        name: '長福會'
      }
    };

    return NextResponse.json(buildSuccessPayload({ payslip }));
  } catch (error) {
    console.error('生成薪資條失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
