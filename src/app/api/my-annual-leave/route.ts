import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { parseIntegerQueryParam } from '@/lib/query-params';
import {
  calculateAnnualLeaveDaysByTotalMonths,
  calculateServiceDuration,
  formatYearsOfServiceInput,
} from '@/lib/annual-leave-rules';
import { getCarryOverStatus, getUsableCarryOverDays } from '@/lib/annual-leave-carry-over';
import { getLeaveRulesConfig } from '@/lib/leave-rules-validator';

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
    // 去年度剩餘能不能延休，以系統設定為準（與核准請假扣帳用的是同一份判斷）
    const rulesConfig = await getLeaveRulesConfig();
    const carryOverPolicy = { enabled: rulesConfig.annualLeaveRollover, maxDays: rulesConfig.annualLeaveRolloverMax };

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

      // 先按員工 ID 建索引，避免每位員工都在兩份陣列裡逐筆搜尋（員工數 × 年度紀錄數）
      const currentLeaveByEmployee = new Map(currentYearLeaves.map(l => [l.employeeId, l]));
      const lastLeaveByEmployee = new Map(lastYearLeaves.map(l => [l.employeeId, l]));

      // 組合資料
      const employeesWithLeave = employees.map(emp => {
        const hireDate = new Date(emp.hireDate);
        const serviceDuration = calculateServiceDuration(hireDate, today);
        const yearsOfService = formatServiceYears(serviceDuration.totalMonths);
        
        const currentLeave = currentLeaveByEmployee.get(emp.id);
        const lastLeave = lastLeaveByEmployee.get(emp.id);
        const lastYearStatus = getCarryOverStatus(lastLeave, carryOverPolicy, today);

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
          lastYear: lastLeave && lastYearStatus ? {
            remainingDays: lastLeave.remainingDays,
            expiryDate: lastLeave.expiryDate,
            // USABLE 才是可延休；EXPIRED／NOT_ENABLED 只是歷史餘額，核准請假不能扣
            status: lastYearStatus,
            usableDays: getUsableCarryOverDays(lastLeave, carryOverPolicy, today)
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
        // 待主管審、待管理員審、已核准都要列（只列前兩段會讓同一張單在轉態的瞬間從清單消失）
        status: { in: ['PENDING', 'PENDING_ADMIN', 'APPROVED'] }
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

    const lastYearStatus = getCarryOverStatus(lastYearLeave, carryOverPolicy, today);
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
        data: lastYearLeave && lastYearStatus ? {
          totalDays: lastYearLeave.totalDays,
          usedDays: lastYearLeave.usedDays,
          remainingDays: lastYearLeave.remainingDays,
          expiryDate: lastYearLeave.expiryDate,
          daysToExpiry: lastYearDaysToExpiry,
          isExpired: lastYearStatus === 'EXPIRED',
          status: lastYearStatus,
          usableDays: getUsableCarryOverDays(lastYearLeave, carryOverPolicy, today)
        } : null
      },
      recentLeaveRequests,
      legalReference: [
        { years: '6個月以上未滿1年', days: 3 },
        { years: '1年以上未滿2年', days: 7 },
        { years: '2年以上未滿3年', days: 10 },
        { years: '3年以上未滿5年', days: 14 },
        { years: '5年以上未滿10年', days: 15 },
        { years: '10年以上', days: '滿10年16天，每年+1天，最多30天' }
      ]
    });
  } catch (error) {
    console.error('取得特休假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
