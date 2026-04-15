import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

function sortStats<T extends { count: number }>(stats: T[]) {
  return stats.sort((left, right) => right.count - left.count);
}

type SalaryLevel = {
  minSalary: number;
  maxSalary: number;
  insuredAmount: number;
};

function resolveInsuredAmount(salary: number, salaryLevels: SalaryLevel[]) {
  if (salaryLevels.length === 0) {
    return salary;
  }

  const matchedLevel = salaryLevels.find((level) => salary >= level.minSalary && salary <= level.maxSalary);
  if (matchedLevel) {
    return matchedLevel.insuredAmount;
  }

  return salaryLevels[salaryLevels.length - 1].insuredAmount;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const [dependents, healthConfig] = await Promise.all([
      prisma.healthInsuranceDependent.findMany({
        where: { isActive: true },
        include: {
          employee: {
            select: {
              id: true,
              department: true,
              baseSalary: true,
              insuredBase: true,
            },
          },
        },
        orderBy: [
          { startDate: 'asc' },
          { id: 'asc' },
        ],
      }),
      prisma.healthInsuranceConfig.findFirst({
        where: { isActive: true },
        orderBy: { effectiveDate: 'desc' },
        include: {
          salaryLevels: {
            orderBy: { level: 'asc' },
          },
        },
      }),
    ]);

    const employeeIds = new Set<number>();
    const departmentSummary = new Map<string, number>();
    const relationshipSummary = new Map<string, number>();
    const monthlySummary = new Map<number, { dependentCount: number; estimatedPremium: number }>();
    const countedDependentsByEmployee = new Map<number, number>();
    const premiumRate = healthConfig?.premiumRate ?? 0.0517;
    const maxDependents = healthConfig?.maxDependents ?? 3;
    const salaryLevels = (healthConfig?.salaryLevels ?? []) as SalaryLevel[];

    for (const dependent of dependents) {
      employeeIds.add(dependent.employeeId);

      const department = dependent.employee?.department?.trim() || '未分類';
      departmentSummary.set(department, (departmentSummary.get(department) || 0) + 1);

      const relationship = dependent.relationship?.trim() || '未分類';
      relationshipSummary.set(relationship, (relationshipSummary.get(relationship) || 0) + 1);

      const month = new Date(dependent.startDate).getMonth() + 1;
      const employeeSalary = dependent.employee?.insuredBase || dependent.employee?.baseSalary || 0;
      const insuredAmount = resolveInsuredAmount(employeeSalary, salaryLevels);
      const individualPremium = Math.round(insuredAmount * premiumRate);
      const currentDependentCount = countedDependentsByEmployee.get(dependent.employeeId) || 0;
      const premiumIncrease = currentDependentCount < maxDependents ? individualPremium : 0;

      countedDependentsByEmployee.set(dependent.employeeId, currentDependentCount + 1);

      const monthSummary = monthlySummary.get(month) || { dependentCount: 0, estimatedPremium: 0 };
      monthSummary.dependentCount += 1;
      monthSummary.estimatedPremium += premiumIncrease;
      monthlySummary.set(month, monthSummary);
    }

    const totalDependents = dependents.length;
    const totalEmployeesWithDependents = employeeIds.size;

    return NextResponse.json({
      summary: {
        totalDependents,
        totalEmployeesWithDependents,
        averageDependentsPerEmployee: totalEmployeesWithDependents === 0
          ? 0
          : Number((totalDependents / totalEmployeesWithDependents).toFixed(2)),
      },
      monthlyStats: Array.from(monthlySummary.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([month, monthSummary]) => ({
          month,
          dependentCount: monthSummary.dependentCount,
          estimatedPremium: monthSummary.estimatedPremium,
        })),
      departmentStats: sortStats(
        Array.from(departmentSummary.entries()).map(([department, count]) => ({ department, count }))
      ),
      relationshipStats: sortStats(
        Array.from(relationshipSummary.entries()).map(([relationship, count]) => ({ relationship, count }))
      ),
    });
  } catch (error) {
    console.error('取得眷屬統計失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}