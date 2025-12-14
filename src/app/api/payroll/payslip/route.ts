import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const payrollId = searchParams.get('payrollId');

    if (!payrollId) {
      return NextResponse.json({ error: '薪資記錄ID為必填' }, { status: 400 });
    }

    // 獲取薪資記錄 - 先簡化查詢
    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: parseInt(payrollId) },
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
        }
      }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    // 權限檢查：員工只能查看自己的薪資條
    if (user.role !== 'ADMIN' && user.role !== 'HR' &&
        user.employeeId !== payrollRecord.employee.id) {
      return NextResponse.json({ error: '無權限查看此薪資條' }, { status: 403 });
    }

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

    if (payrollRecord.incomeTax > 0) {
      deductions.push({
        code: 'INCOME_TAX',
        name: '所得稅',
        amount: payrollRecord.incomeTax,
        quantity: 1,
        unitPrice: payrollRecord.incomeTax,
        description: '代扣所得稅'
      });
    }

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
        total: payrollRecord.regularHours + payrollRecord.overtimeHours
      },
      earnings: earnings,
      deductions: deductions,
      summary: {
        totalEarnings: earnings.reduce((sum: number, item: {amount: number}) => sum + item.amount, 0),
        totalDeductions: deductions.reduce((sum: number, item: {amount: number}) => sum + item.amount, 0),
        netPay: payrollRecord.netPay
      },
      generatedAt: new Date().toISOString(),
      companyInfo: {
        name: '長福會'
      }
    };

    return NextResponse.json({ payslip });
  } catch (error) {
    console.error('生成薪資條失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
