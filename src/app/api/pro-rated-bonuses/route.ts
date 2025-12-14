import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
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

interface BonusResults {
  yearEndBonus?: unknown;
  festivalBonus?: Record<string, unknown>;
}

interface BonusCalculation {
  bonusType: string;
  bonusTypeName: string;
  proRatedAmount: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const employeeId = searchParams.get('employeeId');
    const year = searchParams.get('year') || new Date().getFullYear().toString();
    const bonusType = searchParams.get('bonusType');

    switch (action) {
      case 'calculate-individual':
        return await handleIndividualCalculation(employeeId, year, bonusType);
      
      case 'calculate-batch':
        return await handleBatchCalculation(year, bonusType);
      
      case 'generate-report':
        return await handleReportGeneration(year);
      
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
    const body = await request.json();
    const {
      action,
      employeeIds,
      bonusType,
      year,
      autoCreateRecords = false,
      createdBy
    } = body;

    switch (action) {
      case 'batch-calculate-and-create':
        return await handleBatchCalculateAndCreate(
          employeeIds, 
          bonusType, 
          parseInt(year), 
          autoCreateRecords, 
          createdBy
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
  year: string, 
  bonusType: string | null
) {
  if (!employeeId) {
    return NextResponse.json(
      { success: false, error: '缺少員工ID' },
      { status: 400 }
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { id: parseInt(employeeId) }
  });

  if (!employee) {
    return NextResponse.json(
      { success: false, error: '員工不存在' },
      { status: 404 }
    );
  }

  const targetYear = parseInt(year);
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
async function handleBatchCalculation(year: string, bonusType: string | null) {
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

  const targetYear = parseInt(year);
  const results: BonusResults = {};

  if (!bonusType || bonusType === 'YEAR_END') {
    results.yearEndBonus = await batchCalculateYearEndBonus(employees, targetYear);
  }

  if (!bonusType || bonusType === 'FESTIVAL') {
    results.festivalBonus = {
      springFestival: await batchCalculateFestivalBonus(employees, 'spring_festival', targetYear),
      dragonBoat: await batchCalculateFestivalBonus(employees, 'dragon_boat', targetYear),
      midAutumn: await batchCalculateFestivalBonus(employees, 'mid_autumn', targetYear)
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
async function handleReportGeneration(year: string) {
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

  const targetYear = parseInt(year);
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

  const calculations: BonusCalculation[] = [];
  const createdRecords: unknown[] = [];

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
      // 這裡需要指定具體的節慶類型，暫時使用春節獎金
      const festivalInfo = { name: 'spring_festival', month: 2, description: '春節獎金' };
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
        // 繼續處理其他員工，不中斷整個流程
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      totalProcessed: employees.length,
      calculations,
      createdRecordsCount: createdRecords.length,
      createdRecords: autoCreateRecords ? createdRecords : []
    }
  });
}
