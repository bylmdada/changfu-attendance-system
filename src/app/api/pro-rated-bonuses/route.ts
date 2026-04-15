import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, type JWTPayload } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { 
  calculateYearEndBonus,
  calculateFestivalBonus,
  batchCalculateYearEndBonus,
  batchCalculateFestivalBonus,
  generateProRatedBonusReport
} from '@/lib/pro-rated-bonus-calculator';
import { 
  calculateBonusSupplementaryPremium, 
  getInsuredAmount 
} from '@/lib/tax-calculator';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

interface BonusResults {
  yearEndBonus?: unknown;
  festivalBonus?: Record<string, unknown>;
}

interface BonusCalculation {
  bonusType: string;
  bonusTypeName: string;
  proRatedAmount: number;
}

function isBonusManager(user: JWTPayload | null): user is JWTPayload {
  return !!user && ['ADMIN', 'HR'].includes(user.role);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: string | number, max: number) {
  return parseIntegerQueryParam(String(value), { min: 1, max });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!isBonusManager(user)) {
      return NextResponse.json(
        { success: false, error: '未授權' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const employeeId = searchParams.get('employeeId');
    const year = searchParams.get('year') || new Date().getFullYear().toString();
    const bonusType = searchParams.get('bonusType');

    const yearResult = parsePositiveInteger(year, 9999);
    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json(
        { success: false, error: 'year 參數格式無效' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'calculate-individual':
        return await handleIndividualCalculation(employeeId, yearResult.value, bonusType);
      
      case 'calculate-batch':
        return await handleBatchCalculation(yearResult.value, bonusType);
      
      case 'generate-report':
        return await handleReportGeneration(yearResult.value);
      
      default:
        return NextResponse.json(
          { success: false, error: '無效的操作類型' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('按比例獎金計算失敗:', error);
    return NextResponse.json(
      { success: false, error: '按比例獎金計算失敗' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!isBonusManager(user)) {
      return NextResponse.json(
        { success: false, error: '未授權' },
        { status: 401 }
      );
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { success: false, error: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    if (!user.employeeId) {
      return NextResponse.json(
        { success: false, error: '找不到員工身份' },
        { status: 400 }
      );
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const action = isPlainObject(body) && typeof body.action === 'string'
      ? body.action
      : undefined;
    const employeeIds = isPlainObject(body) && Array.isArray(body.employeeIds) && body.employeeIds.every((id) => typeof id === 'number')
      ? body.employeeIds as number[]
      : undefined;
    const bonusType = isPlainObject(body) && typeof body.bonusType === 'string'
      ? body.bonusType
      : undefined;
    const festivalType = isPlainObject(body) && typeof body.festivalType === 'string'
      ? body.festivalType
      : undefined;
    const year = isPlainObject(body) && (typeof body.year === 'string' || typeof body.year === 'number')
      ? body.year
      : undefined;
    const autoCreateRecords = isPlainObject(body) && typeof body.autoCreateRecords === 'boolean'
      ? body.autoCreateRecords
      : false;

    switch (action) {
      case 'batch-calculate-and-create':
        if (!employeeIds || !bonusType || year === undefined) {
          return NextResponse.json(
            { success: false, error: '缺少必要欄位' },
            { status: 400 }
          );
        }

        const yearResult = parsePositiveInteger(year, 9999);
        if (!yearResult.isValid || yearResult.value === null) {
          return NextResponse.json(
            { success: false, error: 'year 欄位格式無效' },
            { status: 400 }
          );
        }

        return await handleBatchCalculateAndCreate(
          employeeIds, 
          bonusType, 
          festivalType,
          yearResult.value,
          autoCreateRecords, 
          user.employeeId
        );
      
      default:
        return NextResponse.json(
          { success: false, error: '無效的操作類型' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('批量獎金處理失敗:', error);
    return NextResponse.json(
      { success: false, error: '批量獎金處理失敗' },
      { status: 500 }
    );
  }
}

// 處理個別員工計算
async function handleIndividualCalculation(
  employeeId: string | null, 
  year: number,
  bonusType: string | null
) {
  if (!employeeId) {
    return NextResponse.json(
      { success: false, error: '缺少員工ID' },
      { status: 400 }
    );
  }

  const employeeIdResult = parsePositiveInteger(employeeId, 99999999);
  if (!employeeIdResult.isValid || employeeIdResult.value === null) {
    return NextResponse.json(
      { success: false, error: 'employeeId 參數格式無效' },
      { status: 400 }
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeIdResult.value }
  });

  if (!employee) {
    return NextResponse.json(
      { success: false, error: '員工不存在' },
      { status: 404 }
    );
  }

  const targetYear = year;
  const results: BonusResults = {};

  if (!bonusType || bonusType === 'YEAR_END') {
    const bonusConfig = {
      defaultAmount: employee.baseSalary,
      eligibilityRules: {
        minimumServiceMonths: 3,
        mustBeActive: true,
        proRatedForPartialYear: true
      }
    };

    results.yearEndBonus = await calculateYearEndBonus(employee, targetYear, bonusConfig);
  }

  if (!bonusType || bonusType === 'FESTIVAL') {
    const bonusConfig = {
      defaultAmount: 5000,
      eligibilityRules: {
        minimumServiceMonths: 1,
        mustBeActive: true,
        proRatedForPartialYear: true,
        proRatedThreshold: 12
      }
    };

    const festivals = [
      { name: 'spring_festival', month: 2, description: '春節獎金' },
      { name: 'dragon_boat', month: 6, description: '端午節獎金' },
      { name: 'mid_autumn', month: 9, description: '中秋節獎金' }
    ];

    results.festivalBonus = {};
    for (const festival of festivals) {
      results.festivalBonus[festival.name] = await calculateFestivalBonus(
        employee, 
        festival, 
        targetYear, 
        bonusConfig
      );
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      employee: {
        id: employee.id,
        name: employee.name,
        employeeId: employee.employeeId,
        hireDate: employee.hireDate,
        baseSalary: employee.baseSalary,
        isActive: employee.isActive
      },
      calculations: results,
      targetYear
    }
  });
}

// 處理批量計算
async function handleBatchCalculation(year: number, bonusType: string | null) {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      employeeId: true,
      hireDate: true,
      baseSalary: true,
      isActive: true,
      department: true,
      position: true
    }
  });

  const targetYear = year;
  const results: BonusResults = {};

  if (!bonusType || bonusType === 'YEAR_END') {
    results.yearEndBonus = await batchCalculateYearEndBonus(employees, targetYear);
  }

  if (!bonusType || bonusType === 'FESTIVAL') {
    results.festivalBonus = {
      spring_festival: await batchCalculateFestivalBonus(employees, 'spring_festival', targetYear),
      dragon_boat: await batchCalculateFestivalBonus(employees, 'dragon_boat', targetYear),
      mid_autumn: await batchCalculateFestivalBonus(employees, 'mid_autumn', targetYear)
    };
  }

  return NextResponse.json({
    success: true,
    data: {
      totalEmployees: employees.length,
      targetYear,
      calculations: results
    }
  });
}

// 處理報表生成
async function handleReportGeneration(year: number) {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      employeeId: true,
      hireDate: true,
      baseSalary: true,
      isActive: true,
      department: true,
      position: true
    }
  });

  const targetYear = year;
  const report = await generateProRatedBonusReport(
    employees.map(emp => ({
      ...emp,
      department: emp.department || undefined,
      position: emp.position || undefined
    })), 
    targetYear
  );

  return NextResponse.json({
    success: true,
    data: report
  });
}

// 處理批量計算並創建記錄
async function handleBatchCalculateAndCreate(
  employeeIds: number[],
  bonusType: string,
  festivalType: string | undefined,
  year: number,
  autoCreateRecords: boolean,
  createdBy: number
) {
  const employees = await prisma.employee.findMany({
    where: {
      id: { in: employeeIds },
      isActive: true
    },
    select: {
      id: true,
      name: true,
      employeeId: true,
      hireDate: true,
      baseSalary: true,
      isActive: true,
      dependents: true
    }
  });
  
  const activeEmployeeIds = new Set(employees.map((employee) => employee.id));
  const missingOrInactiveEmployeeIds = Array.from(
    new Set(employeeIds.filter((employeeId) => !activeEmployeeIds.has(employeeId)))
  );

  const calculations: BonusCalculation[] = [];
  const createdRecords: unknown[] = [];
  const failedEmployeeIds: number[] = [];
  const creationErrors: string[] = [];
  
  if (missingOrInactiveEmployeeIds.length > 0) {
    failedEmployeeIds.push(...missingOrInactiveEmployeeIds);
    creationErrors.push(
      ...missingOrInactiveEmployeeIds.map((employeeId) => `員工 ID ${employeeId} 不存在或已停用`)
    );
  }

  for (const employee of employees) {
    let bonusCalculation: BonusCalculation;
    let payrollMonth: number;

    if (bonusType === 'YEAR_END') {
      const bonusConfig = {
        defaultAmount: employee.baseSalary,
        eligibilityRules: {
          minimumServiceMonths: 3,
          mustBeActive: true,
          proRatedForPartialYear: true
        }
      };

      bonusCalculation = await calculateYearEndBonus(employee, year, bonusConfig);
      payrollMonth = 12; // 年終獎金通常在12月發放
    } else if (bonusType === 'FESTIVAL') {
      const festivalConfigMap = {
        spring_festival: { name: 'spring_festival', month: 2, description: '春節獎金' },
        dragon_boat: { name: 'dragon_boat', month: 6, description: '端午節獎金' },
        mid_autumn: { name: 'mid_autumn', month: 9, description: '中秋節獎金' }
      } as const;
      const festivalInfo = festivalType ? festivalConfigMap[festivalType as keyof typeof festivalConfigMap] : undefined;

      if (!festivalInfo) {
        continue;
      }

      const bonusConfig = {
        defaultAmount: 5000,
        eligibilityRules: {
          minimumServiceMonths: 1,
          mustBeActive: true,
          proRatedForPartialYear: true,
          proRatedThreshold: 12
        }
      };

      bonusCalculation = await calculateFestivalBonus(employee, festivalInfo, year, bonusConfig);
      payrollMonth = festivalInfo.month;
    } else {
      continue; // 跳過不支援的獎金類型
    }

    calculations.push(bonusCalculation);

    // 如果獎金金額大於0且需要自動創建記錄
    if (bonusCalculation.proRatedAmount > 0 && autoCreateRecords) {
      try {
        // 計算健保投保金額
        const insuredAmount = getInsuredAmount(employee.baseSalary);

        // 取得或創建年度獎金累計記錄
        const annualBonus = await prisma.employeeAnnualBonus.upsert({
          where: {
            employeeId_year: {
              employeeId: employee.id,
              year: year
            }
          },
          create: {
            employeeId: employee.id,
            year: year,
            totalBonusAmount: 0,
            supplementaryPremium: 0
          },
          update: {}
        });

        // 計算補充保費
        const supplementaryCalculation = calculateBonusSupplementaryPremium(
          insuredAmount,
          annualBonus.totalBonusAmount,
          bonusCalculation.proRatedAmount
        );

        // 創建獎金記錄
        const bonusRecord = await prisma.bonusRecord.create({
          data: {
            employeeId: employee.id,
            annualBonusId: annualBonus.id,
            bonusType: bonusCalculation.bonusType,
            bonusTypeName: bonusCalculation.bonusTypeName,
            amount: bonusCalculation.proRatedAmount,
            payrollYear: year,
            payrollMonth: payrollMonth,
            insuredAmount,
            exemptThreshold: supplementaryCalculation.exemptThreshold,
            cumulativeBonusBefore: supplementaryCalculation.currentYearBonusTotal,
            cumulativeBonusAfter: supplementaryCalculation.currentYearBonusTotal + bonusCalculation.proRatedAmount,
            calculationBase: supplementaryCalculation.calculationBase,
            supplementaryPremium: supplementaryCalculation.premiumAmount,
            premiumRate: supplementaryCalculation.premiumRate,
            isAdjustment: false,
            createdBy
          }
        });

        // 更新年度累計記錄
        await prisma.employeeAnnualBonus.update({
          where: { id: annualBonus.id },
          data: {
            totalBonusAmount: {
              increment: bonusCalculation.proRatedAmount
            },
            supplementaryPremium: {
              increment: supplementaryCalculation.premiumAmount
            }
          }
        });

        createdRecords.push({
          employee,
          bonusCalculation,
          bonusRecord,
          supplementaryCalculation
        });

      } catch (error) {
        console.error(`創建員工 ${employee.name} 的獎金記錄失敗:`, error);
        failedEmployeeIds.push(employee.id);
        creationErrors.push(`員工 ${employee.name} 的獎金記錄建立失敗`);
        // 繼續處理其他員工，不中斷整個流程
      }
    }
  }

  if (autoCreateRecords && createdRecords.length === 0 && failedEmployeeIds.length > 0) {
    return NextResponse.json({
      success: false,
      error: '所有獎金記錄建立失敗',
      failedEmployeeIds,
      errors: creationErrors,
    }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      totalProcessed: employees.length,
      calculations,
      createdRecordsCount: createdRecords.length,
      failedRecordsCount: failedEmployeeIds.length,
      failedEmployeeIds,
      errors: creationErrors,
      createdRecords: autoCreateRecords ? createdRecords : []
    }
  });
}
