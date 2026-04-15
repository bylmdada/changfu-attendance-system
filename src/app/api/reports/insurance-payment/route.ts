import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { toCsvRow } from '@/lib/csv';
import { parseIntegerQueryParam } from '@/lib/query-params';

/**
 * 勞健保費率查表
 * 勞保：投保薪資分級表
 * 健保：投保金額分級表
 */
const LABOR_INSURANCE_GRADES = [
  27470, 28800, 30300, 31800, 33300, 34800, 36300, 38200, 40100,
  42000, 43900, 45800 // 最高級
];

const HEALTH_INSURANCE_GRADES = [
  27470, 28800, 30300, 31800, 33300, 34800, 36300, 38200, 40100,
  42000, 43900, 45800, 48200, 50600, 53000, 55400, 57800, 60800,
  63800, 66800, 69800, 72800, 76500, 80200, 83900, 87600, 92100,
  96600, 101100, 105600, 110100, 115500, 120900, 126300, 131700,
  137100, 142500, 147900, 150000, 156400, 162800, 169200, 175600,
  182000, 189500, 219500 // 最高級
];

/**
 * 根據月薪查找投保金額
 */
function findInsuredAmount(salary: number, grades: number[]): number {
  for (const grade of grades) {
    if (salary <= grade) return grade;
  }
  return grades[grades.length - 1];
}

/**
 * GET - 匯出勞健保繳費清冊
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

    const monthResult = parseIntegerQueryParam(searchParams.get('month'), {
      defaultValue: new Date().getMonth() + 1,
      min: 1,
      max: 12,
    });
    if (!monthResult.isValid) {
      return NextResponse.json({ error: '無效的月份參數' }, { status: 400 });
    }

    const year = yearResult.value!;
    const month = monthResult.value!;
    const format = searchParams.get('format') || 'json'; // json, csv

    if (!['json', 'csv'].includes(format)) {
      return NextResponse.json({ error: '無效的格式參數' }, { status: 400 });
    }

    // 取得勞保費率設定
    const laborConfig = await prisma.laborLawConfig.findFirst({
      where: { isActive: true },
      orderBy: { effectiveDate: 'desc' }
    });

    // 取得健保費率設定
    const healthConfig = await prisma.healthInsuranceConfig.findFirst({
      where: { isActive: true },
      orderBy: { effectiveDate: 'desc' }
    });

    // 預設費率
    const laborRate = laborConfig?.laborInsuranceRate || 0.115;
    const laborEmployeeRate = laborConfig?.laborEmployeeRate || 0.2;
    const healthRate = healthConfig?.premiumRate || 0.0517;
    const healthEmployeeRate = healthConfig?.employeeContributionRatio || 0.3;

    // 取得所有在職員工
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        baseSalary: true,
        insuredBase: true,
        dependents: true,
        healthInsuranceActive: true
      },
      orderBy: { name: 'asc' }
    });

    // 計算每位員工的勞健保
    const records = employees.map(emp => {
      const salary = emp.baseSalary;
      const insuredBase = emp.insuredBase || salary;
      
      // 勞保
      const laborInsuredAmount = findInsuredAmount(insuredBase, LABOR_INSURANCE_GRADES);
      const laborTotal = Math.round(laborInsuredAmount * laborRate);
      const laborEmployee = Math.round(laborTotal * laborEmployeeRate);
      const laborEmployer = laborTotal - laborEmployee;
      
      // 健保
      const healthInsuredAmount = findInsuredAmount(insuredBase, HEALTH_INSURANCE_GRADES);
      const dependents = Math.min(emp.dependents || 0, 3);
      const totalPersons = 1 + dependents;
      const healthTotal = Math.round(healthInsuredAmount * healthRate * totalPersons);
      const healthEmployee = Math.round(healthTotal * healthEmployeeRate);
      const healthEmployer = Math.round(healthTotal * 0.6);
      
      return {
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department,
        baseSalary: salary,
        insuredBase: insuredBase,
        // 勞保
        laborInsuredAmount,
        laborEmployee,
        laborEmployer,
        laborTotal,
        // 健保
        healthInsuredAmount,
        dependents,
        totalPersons,
        healthEmployee,
        healthEmployer,
        healthTotal,
        // 總計
        totalEmployee: laborEmployee + healthEmployee,
        totalEmployer: laborEmployer + healthEmployer,
        isHealthActive: emp.healthInsuranceActive
      };
    });

    // 統計
    const summary = {
      year,
      month,
      totalEmployees: records.length,
      laborTotal: records.reduce((sum, r) => sum + r.laborTotal, 0),
      laborEmployee: records.reduce((sum, r) => sum + r.laborEmployee, 0),
      laborEmployer: records.reduce((sum, r) => sum + r.laborEmployer, 0),
      healthTotal: records.reduce((sum, r) => sum + r.healthTotal, 0),
      healthEmployee: records.reduce((sum, r) => sum + r.healthEmployee, 0),
      healthEmployer: records.reduce((sum, r) => sum + r.healthEmployer, 0),
      grandTotalEmployee: records.reduce((sum, r) => sum + r.totalEmployee, 0),
      grandTotalEmployer: records.reduce((sum, r) => sum + r.totalEmployer, 0)
    };

    if (format === 'csv') {
      // 匯出 CSV
      const headers = [
        '員工編號', '姓名', '部門', '底薪', '投保薪資',
        '勞保投保金額', '勞保員工負擔', '勞保公司負擔', '勞保合計',
        '健保投保金額', '健保眷屬數', '健保員工負擔', '健保公司負擔', '健保合計',
        '員工負擔總計', '公司負擔總計'
      ];

      const csvRows = [
        toCsvRow(headers),
        ...records.map(r => toCsvRow([
          r.employeeId, r.name, r.department, r.baseSalary, r.insuredBase,
          r.laborInsuredAmount, r.laborEmployee, r.laborEmployer, r.laborTotal,
          r.healthInsuredAmount, r.dependents, r.healthEmployee, r.healthEmployer, r.healthTotal,
          r.totalEmployee, r.totalEmployer
        ])),
        '',
        toCsvRow([
          '合計', '', '', '', '', '',
          summary.laborEmployee,
          summary.laborEmployer,
          summary.laborTotal,
          '',
          '',
          summary.healthEmployee,
          summary.healthEmployer,
          summary.healthTotal,
          summary.grandTotalEmployee,
          summary.grandTotalEmployer
        ])
      ];

      const csvContent = '\uFEFF' + csvRows.join('\n'); // BOM for Excel
      
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="insurance_payment_${year}${month.toString().padStart(2, '0')}.csv"`
        }
      });
    }

    return NextResponse.json({
      success: true,
      period: { year, month },
      records,
      summary,
      rates: {
        laborRate,
        laborEmployeeRate,
        healthRate,
        healthEmployeeRate
      }
    });
  } catch (error) {
    console.error('匯出勞健保清冊失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
