import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { parseIntegerQueryParam } from '@/lib/query-params';
import {
  calculateAnnualLeaveDaysByTotalMonths,
  calculateServiceDuration,
  formatYearsOfServiceInput,
} from '@/lib/annual-leave-rules';

function formatServiceYears(totalMonths: number): number {
  return Number(formatYearsOfServiceInput(totalMonths));
}

/**
 * 特休假查詢 API
 * - 一般員工：只能查看自己的特休假
 * - ADMIN/HR：可查看所有員工，支持部門篩選
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const department = searchParams.get('department');
    const targetEmployeeId = searchParams.get('employeeId');
    const viewMode = searchParams.get('mode'); // 'all' for admin view

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;
    const today = new Date();
    const isAdmin = user.role === 'ADMIN' || user.role === 'HR';

    // 管理員查看全部員工模式
    if (isAdmin && viewMode === 'all') {
      // 取得所有部門（用於篩選器）
      const allDepartments = await prisma.employee.findMany({
        where: { isActive: true },
        select: { department: true },
        distinct: ['department']
      });
      const departments = allDepartments
        .map(e => e.department)
        .filter((d): d is string => d !== null)
        .sort();

      // 建立查詢條件
      const whereCondition: { isActive: boolean; department?: string } = { isActive: true };
      if (department && department !== 'all') {
        whereCondition.department = department;
      }

      // 取得所有員工
      const employees = await prisma.employee.findMany({
        where: whereCondition,
        select: {
          id: true,
          employeeId: true,
          name: true,
          department: true,
          position: true,
          hireDate: true
        },
        orderBy: [{ department: 'asc' }, { name: 'asc' }]
      });

      // 取得所有員工的年假資料
      const employeeIds = employees.map(e => e.id);
      
      const currentYearLeaves = await prisma.annualLeave.findMany({
        where: {
          employeeId: { in: employeeIds },
          year: currentYear
        }
      });

      const lastYearLeaves = await prisma.annualLeave.findMany({
        where: {
          employeeId: { in: employeeIds },
          year: lastYear
        }
      });

      // 組合資料
      const employeesWithLeave = employees.map(emp => {
        const hireDate = new Date(emp.hireDate);
        const serviceDuration = calculateServiceDuration(hireDate, today);
        const yearsOfService = formatServiceYears(serviceDuration.totalMonths);
        
        const currentLeave = currentYearLeaves.find(l => l.employeeId === emp.id);
        const lastLeave = lastYearLeaves.find(l => l.employeeId === emp.id);

        const daysToExpiry = currentLeave?.expiryDate
          ? Math.ceil((new Date(currentLeave.expiryDate).getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
          : null;

        return {
          ...emp,
          hireDate: emp.hireDate,
          yearsOfService,
          legalDays: calculateAnnualLeaveDaysByTotalMonths(serviceDuration.totalMonths),
          currentYear: currentLeave ? {
            totalDays: currentLeave.totalDays,
            usedDays: currentLeave.usedDays,
            remainingDays: currentLeave.remainingDays,
            expiryDate: currentLeave.expiryDate,
            daysToExpiry
          } : null,
          lastYear: lastLeave && lastLeave.remainingDays > 0 ? {
            remainingDays: lastLeave.remainingDays,
            expiryDate: lastLeave.expiryDate
          } : null
        };
      });

      return NextResponse.json({
        success: true,
        isAdmin: true,
        departments,
        employees: employeesWithLeave,
        currentYear: currentYear,
        lastYear: lastYear
      });
    }

    // 個人模式或查看特定員工
    let targetEmpId = user.employeeId;
    if (isAdmin && targetEmployeeId) {
      const targetEmployeeIdResult = parseIntegerQueryParam(targetEmployeeId, { min: 1, max: 99999999 });
      if (!targetEmployeeIdResult.isValid || targetEmployeeIdResult.value === null) {
        return NextResponse.json({ error: 'employeeId 參數格式無效' }, { status: 400 });
      }

      targetEmpId = targetEmployeeIdResult.value;
    }

    // 取得員工基本資訊
    const employee = await prisma.employee.findUnique({
      where: { id: targetEmpId },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        position: true,
        hireDate: true,
        isActive: true
      }
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    // 計算年資
    const hireDate = new Date(employee.hireDate);
    const serviceDuration = calculateServiceDuration(hireDate, today);
    const yearsOfService = formatServiceYears(serviceDuration.totalMonths);

    // 計算週年制給假日
    const grantMonth = hireDate.getMonth();
    const grantDay = hireDate.getDate();
    let grantDate = new Date(currentYear, grantMonth, grantDay);
    if (grantDate > today) {
      grantDate = new Date(currentYear - 1, grantMonth, grantDay);
    }

    // 取得今年特休
    const currentYearLeave = await prisma.annualLeave.findUnique({
      where: {
        employeeId_year: {
          employeeId: targetEmpId,
          year: currentYear
        }
      }
    });

    // 取得去年特休
    const lastYearLeave = await prisma.annualLeave.findUnique({
      where: {
        employeeId_year: {
          employeeId: targetEmpId,
          year: lastYear
        }
      }
    });

    // 取得近期請假紀錄
    const recentLeaveRequests = await prisma.leaveRequest.findMany({
      where: {
        employeeId: targetEmpId,
        leaveType: { in: ['ANNUAL', 'ANNUAL_LEAVE'] },
        status: { in: ['PENDING', 'APPROVED'] }
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        totalDays: true,
        reason: true,
        status: true,
        createdAt: true
      }
    });

    const legalDays = calculateAnnualLeaveDaysByTotalMonths(serviceDuration.totalMonths);

    const daysToExpiry = currentYearLeave?.expiryDate
      ? Math.ceil((new Date(currentYearLeave.expiryDate).getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    const lastYearDaysToExpiry = lastYearLeave?.expiryDate
      ? Math.ceil((new Date(lastYearLeave.expiryDate).getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    return NextResponse.json({
      success: true,
      isAdmin,
      employee: {
        ...employee,
        yearsOfService,
        grantDate: grantDate.toISOString(),
        legalDays
      },
      currentYear: {
        year: currentYear,
        data: currentYearLeave ? {
          totalDays: currentYearLeave.totalDays,
          usedDays: currentYearLeave.usedDays,
          remainingDays: currentYearLeave.remainingDays,
          expiryDate: currentYearLeave.expiryDate,
          daysToExpiry
        } : null
      },
      lastYear: {
        year: lastYear,
        data: lastYearLeave && lastYearLeave.remainingDays > 0 ? {
          totalDays: lastYearLeave.totalDays,
          usedDays: lastYearLeave.usedDays,
          remainingDays: lastYearLeave.remainingDays,
          expiryDate: lastYearLeave.expiryDate,
          daysToExpiry: lastYearDaysToExpiry,
          isExpired: lastYearDaysToExpiry !== null && lastYearDaysToExpiry < 0
        } : null
      },
      recentLeaveRequests,
      legalReference: [
        { years: '6個月以上未滿1年', days: 3 },
        { years: '1年以上未滿2年', days: 7 },
        { years: '2年以上未滿3年', days: 10 },
        { years: '3年以上未滿5年', days: 14 },
        { years: '5年以上未滿10年', days: 15 },
        { years: '10年以上', days: '每年+1天，最多30天' }
      ]
    });
  } catch (error) {
    console.error('取得特休假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
