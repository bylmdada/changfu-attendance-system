import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { toCsvRow } from '@/lib/csv';
import { parseIntegerQueryParam } from '@/lib/query-params';

/**
 * 所得稅申報資料匯出 API
 * 匯出符合國稅局格式的薪資所得資料
 */

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearResult = parseIntegerQueryParam(searchParams.get('year'), {
      defaultValue: new Date().getFullYear(),
      min: 1900,
      max: 9999,
    });
    if (!yearResult.isValid) {
      return NextResponse.json({ error: '無效的年份參數' }, { status: 400 });
    }

    const year = yearResult.value!;
    const format = searchParams.get('format') || 'json';

    if (!['json', 'csv'].includes(format)) {
      return NextResponse.json({ error: '無效的格式參數' }, { status: 400 });
    }

    // 取得該年度所有薪資記錄
    const payrollRecords = await prisma.payrollRecord.findMany({
      where: {
        payYear: year
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            hireDate: true
          }
        }
      },
      orderBy: [
        { employeeId: 'asc' },
        { payMonth: 'asc' }
      ]
    });

    // 按員工彙總年度所得
    const employeeSummary = new Map<number, {
      employeeId: string;
      name: string;
      department: string;
      hireDate: Date;
      totalBasePay: number;         // 底薪總額
      totalOvertimePay: number;     // 加班費總額
      totalGrossPay: number;        // 所得總額
      totalLaborInsurance: number;  // 勞保自付總額
      totalHealthInsurance: number; // 健保自付總額
      totalLaborPensionSelf: number; // 勞退自提總額
      totalIncomeTax: number;       // 代扣所得稅總額
      totalNetPay: number;          // 實發總額
      months: number;               // 工作月數
    }>();

    for (const record of payrollRecords) {
      const empId = record.employeeId;
      const existing = employeeSummary.get(empId);

      if (existing) {
        existing.totalBasePay += record.basePay;
        existing.totalOvertimePay += record.overtimePay;
        existing.totalGrossPay += record.grossPay;
        existing.totalLaborInsurance += record.laborInsurance;
        existing.totalHealthInsurance += record.healthInsurance;
        existing.totalLaborPensionSelf += record.laborPensionSelf || 0;
        existing.totalIncomeTax += record.incomeTax;
        existing.totalNetPay += record.netPay;
        existing.months++;
      } else {
        employeeSummary.set(empId, {
          employeeId: record.employee.employeeId,
          name: record.employee.name,
          department: record.employee.department || '',
          hireDate: record.employee.hireDate,
          totalBasePay: record.basePay,
          totalOvertimePay: record.overtimePay,
          totalGrossPay: record.grossPay,
          totalLaborInsurance: record.laborInsurance,
          totalHealthInsurance: record.healthInsurance,
          totalLaborPensionSelf: record.laborPensionSelf || 0,
          totalIncomeTax: record.incomeTax,
          totalNetPay: record.netPay,
          months: 1
        });
      }
    }


    const records = Array.from(employeeSummary.values()).map(emp => ({
      ...emp,
      // 免稅所得（加班費前46小時免稅，簡化處理）
      taxExempt: Math.min(emp.totalOvertimePay, 46 * 12 * 200), // 假設時薪200
      // 應稅所得
      taxableIncome: emp.totalGrossPay - emp.totalLaborInsurance - emp.totalHealthInsurance,
      hireDate: emp.hireDate.toISOString().split('T')[0]
    }));

    // 統計
    const summary = {
      year,
      totalEmployees: records.length,
      totalGrossPay: records.reduce((sum, r) => sum + r.totalGrossPay, 0),
      totalLaborInsurance: records.reduce((sum, r) => sum + r.totalLaborInsurance, 0),
      totalHealthInsurance: records.reduce((sum, r) => sum + r.totalHealthInsurance, 0),
      totalIncomeTax: records.reduce((sum, r) => sum + r.totalIncomeTax, 0),
      totalTaxableIncome: records.reduce((sum, r) => sum + r.taxableIncome, 0)
    };

    if (format === 'csv') {
      const headers = [
        '員工編號', '姓名', '部門', '到職日', '工作月數',
        '底薪總額', '加班費總額', '所得總額',
        '勞保自付', '健保自付', '代扣所得稅',
        '應稅所得', '實發總額'
      ];

      const csvRows = [
        toCsvRow(headers),
        ...records.map(r => toCsvRow([
          r.employeeId, r.name, r.department, r.hireDate, r.months,
          r.totalBasePay, r.totalOvertimePay, r.totalGrossPay,
          r.totalLaborInsurance, r.totalHealthInsurance, r.totalIncomeTax,
          r.taxableIncome, r.totalNetPay
        ])),
        '',
        toCsvRow([
          '合計', '', '', '', '', '', '',
          summary.totalGrossPay,
          summary.totalLaborInsurance,
          summary.totalHealthInsurance,
          summary.totalIncomeTax,
          summary.totalTaxableIncome,
          ''
        ])
      ];

      const csvContent = '\uFEFF' + csvRows.join('\n');
      
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tax_declaration_${year}.csv"`
        }
      });
    }

    return NextResponse.json({
      success: true,
      year,
      records,
      summary
    });
  } catch (error) {
    console.error('匯出所得稅申報資料失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
