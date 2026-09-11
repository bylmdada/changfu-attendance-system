import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { DEFAULT_LABOR_LAW_CONFIG } from '@/lib/labor-law-config-defaults';
import { toCsvRow } from '@/lib/csv';
import { parseIntegerQueryParam } from '@/lib/query-params';
import {
  calculateHealthInsurancePremium,
  calculateLaborInsurancePremium,
  findInsuredAmountByLevels,
  resolveHealthInsuranceLevels,
  LABOR_INSURANCE_2026_LEVELS,
} from '@/lib/insurance-calculator';

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
      orderBy: { effectiveDate: 'desc' },
      include: {
        salaryLevels: {
          orderBy: { level: 'asc' },
        },
      },
    });

    // 預設費率
    const laborRate = laborConfig?.laborInsuranceRate || DEFAULT_LABOR_LAW_CONFIG.laborInsuranceRate;
    const employmentRate = laborConfig?.employmentInsuranceRate || DEFAULT_LABOR_LAW_CONFIG.employmentInsuranceRate;
    const laborEmployeeRate = laborConfig?.laborEmployeeRate || DEFAULT_LABOR_LAW_CONFIG.laborEmployeeRate;
    const laborInsuranceMax = laborConfig?.laborInsuranceMax || DEFAULT_LABOR_LAW_CONFIG.laborInsuranceMax;
    const healthRate = healthConfig?.premiumRate || 0.0517;
    const healthEmployeeRate = healthConfig?.employeeContributionRatio || 0.3;
    const healthCompanyRate = healthConfig?.companyContributionRatio || 0.6;
    const healthGovernmentRate = healthConfig?.governmentSubsidyRatio || 0.1;
    const maxDependents = healthConfig?.maxDependents || 3;
    const healthSalaryLevels = resolveHealthInsuranceLevels(healthConfig?.salaryLevels);

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
        laborInsuranceActive: true,
        healthInsuranceActive: true
      },
      orderBy: { name: 'asc' }
    });

    // 計算每位員工的勞健保
    const records = employees.map(emp => {
      const salary = emp.baseSalary;
      const insuredBase = emp.insuredBase || salary;
      
      // 勞保
      const isLaborActive = emp.laborInsuranceActive !== false;
      const laborCalculation = isLaborActive
        ? calculateLaborInsurancePremium({
            salary: Math.min(insuredBase, laborInsuranceMax),
            ordinaryRate: laborRate,
            employmentRate,
            employeeRate: laborEmployeeRate,
            maxInsuredAmount: laborInsuranceMax,
          })
        : null;
      const laborInsuredAmount = isLaborActive
        ? laborCalculation?.insuredAmount ?? findInsuredAmountByLevels(Math.min(insuredBase, laborInsuranceMax), LABOR_INSURANCE_2026_LEVELS)
        : 0;
      const laborEmployee = laborCalculation?.employeePremium ?? 0;
      const laborEmployer = laborCalculation?.employerPremium ?? 0;
      const laborGovernment = laborCalculation?.governmentPremium ?? 0;
      const laborTotal = laborCalculation?.totalPremium ?? 0;
      
      // 健保
      const isHealthActive = emp.healthInsuranceActive !== false;
      const healthCalculation = isHealthActive
        ? calculateHealthInsurancePremium({
            salary: insuredBase,
            premiumRate: healthRate,
            employeeRate: healthEmployeeRate,
            employerRate: healthCompanyRate,
            governmentRate: healthGovernmentRate,
            dependents: emp.dependents || 0,
            maxDependents,
            levels: healthSalaryLevels,
          })
        : null;
      const healthInsuredAmount = healthCalculation?.insuredAmount ?? 0;
      const dependents = healthCalculation?.dependents ?? 0;
      const totalPersons = healthCalculation?.totalPersons ?? 0;
      const healthTotal = healthCalculation?.totalPremium ?? 0;
      const healthEmployee = healthCalculation?.employeePremium ?? 0;
      const healthEmployer = healthCalculation?.employerPremium ?? 0;
      const healthGovernment = healthCalculation?.governmentPremium ?? 0;
      
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
        laborGovernment,
        laborTotal,
        // 健保
        healthInsuredAmount,
        dependents,
        totalPersons,
        healthEmployee,
        healthEmployer,
        healthGovernment,
        healthTotal,
        // 總計
        totalEmployee: laborEmployee + healthEmployee,
        totalEmployer: laborEmployer + healthEmployer,
        isHealthActive
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
      laborGovernment: records.reduce((sum, r) => sum + r.laborGovernment, 0),
      healthTotal: records.reduce((sum, r) => sum + r.healthTotal, 0),
      healthEmployee: records.reduce((sum, r) => sum + r.healthEmployee, 0),
      healthEmployer: records.reduce((sum, r) => sum + r.healthEmployer, 0),
      healthGovernment: records.reduce((sum, r) => sum + r.healthGovernment, 0),
      grandTotalEmployee: records.reduce((sum, r) => sum + r.totalEmployee, 0),
      grandTotalEmployer: records.reduce((sum, r) => sum + r.totalEmployer, 0)
    };

    if (format === 'csv') {
      // 匯出 CSV
      const headers = [
        '員工編號', '姓名', '部門', '底薪', '投保薪資',
        '勞保投保金額', '勞保員工負擔', '勞保公司負擔', '勞保政府補助', '勞保合計',
        '健保投保金額', '健保眷屬數', '健保員工負擔', '健保公司負擔', '健保政府補助', '健保合計',
        '員工負擔總計', '公司負擔總計'
      ];

      const csvRows = [
        toCsvRow(headers),
        ...records.map(r => toCsvRow([
          r.employeeId, r.name, r.department, r.baseSalary, r.insuredBase,
          r.laborInsuredAmount, r.laborEmployee, r.laborEmployer, r.laborGovernment, r.laborTotal,
          r.healthInsuredAmount, r.dependents, r.healthEmployee, r.healthEmployer, r.healthGovernment, r.healthTotal,
          r.totalEmployee, r.totalEmployer
        ])),
        '',
        toCsvRow([
          '合計', '', '', '', '', '',
          summary.laborEmployee,
          summary.laborEmployer,
          summary.laborGovernment,
          summary.laborTotal,
          '',
          '',
          summary.healthEmployee,
          summary.healthEmployer,
          summary.healthGovernment,
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
        employmentRate,
        laborEmployeeRate,
        healthRate,
        healthEmployeeRate,
        healthCompanyRate,
        healthGovernmentRate
      }
    });
  } catch (error) {
    console.error('匯出勞健保清冊失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
