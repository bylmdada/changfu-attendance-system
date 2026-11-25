import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';
import {
  getTaiwanDateParts,
  getTaiwanMonthStart,
  getTaiwanTimeParts,
  getTaiwanTodayEnd,
  getTaiwanTodayStart,
  toTaiwanDateStr,
} from '@/lib/timezone';
import { calculateOvertimeRequestsEligibility } from '@/lib/overtime-eligibility';
import { calculateLeaveHoursByDate, type LeaveDurationScheduleMap } from '@/lib/leave-management-helpers';
import { isWorkingSchedule } from '@/lib/perfect-attendance';

// 兩段審核都算「待審核」：初審（PENDING）與已到管理員複核（PENDING_ADMIN）
const PENDING_STATUSES = ['PENDING', 'PENDING_ADMIN'];

const pad2 = (value: number) => String(value).padStart(2, '0');
const round2 = (value: number) => Math.round(value * 100) / 100;

/** 一張核准假單落在指定月份內的請假時數（與請假申請相同，依當天班表計算，跨月會拆開）。 */
function getLeaveHoursInMonth(
  leave: { startDate: Date; endDate: Date },
  schedulesByDate: LeaveDurationScheduleMap | undefined,
  monthPrefix: string
) {
  const start = getTaiwanTimeParts(leave.startDate);
  const end = getTaiwanTimeParts(leave.endDate);
  const hoursByDate = calculateLeaveHoursByDate({
    startDate: toTaiwanDateStr(leave.startDate),
    endDate: toTaiwanDateStr(leave.endDate),
    startHour: String(start.hour),
    startMinute: String(start.minute),
    endHour: String(end.hour),
    endMinute: String(end.minute),
  }, schedulesByDate) ?? {};

  return Object.entries(hoursByDate)
    .filter(([date]) => date.startsWith(monthPrefix))
    .reduce((sum, [, hours]) => sum + hours, 0);
}

// GET - 取得儀表板統計資料
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!['ADMIN', 'HR', 'SUPERVISOR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理權限' }, { status: 403 });
    }

    const hasFullAccess = decoded.role === 'ADMIN' || decoded.role === 'HR';
    const manageableDepartments = hasFullAccess ? [] : await getManageableDepartments(decoded);

    if (!hasFullAccess && manageableDepartments.length === 0) {
      return NextResponse.json({ error: '無權限查看儀表板統計' }, { status: 403 });
    }

    const employeeScope = hasFullAccess ? undefined : { department: { in: manageableDepartments } };
    const scopeFilter = employeeScope ? { employee: employeeScope } : {};

    const { searchParams } = new URL(request.url);
    const todayNow = new Date();
    const taiwanToday = getTaiwanDateParts(todayNow);
    const year = Number(searchParams.get('year') || taiwanToday.year);
    const month = Number(searchParams.get('month') || taiwanToday.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: '年月參數不正確' }, { status: 400 });
    }

    // 月份範圍一律用台北日曆：含月初、不含下個月月初
    const monthStart = getTaiwanMonthStart(year, month);
    const nextMonthStart = getTaiwanMonthStart(year, month + 1);
    const monthPrefix = `${year}-${pad2(month)}`;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstDate = `${monthPrefix}-01`;
    const lastDate = `${monthPrefix}-${pad2(daysInMonth)}`;

    // 出勤率只算到統計日：過去的月份整月、進行中的月份到今天、未來的月份沒有應到班次
    const todayText = toTaiwanDateStr(todayNow);
    const cutoffDate = todayText < firstDate ? null : todayText < lastDate ? todayText : lastDate;

    // 取得所有在職員工（員工數、部門人數與應到班次都以這份名單為準）
    const employees = await prisma.employee.findMany({
      where: {
        isActive: true,
        ...(employeeScope || {}),
      },
      select: { id: true, department: true },
    });
    const totalEmployees = employees.length;

    // 取得本月考勤記錄
    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        workDate: {
          gte: monthStart,
          lt: nextMonthStart,
        },
        ...scopeFilter,
      },
      select: { employeeId: true, workDate: true, clockInTime: true },
    });

    // 取得本月班表：有班表的人依實際排班算應出勤，沒有任何班表紀錄的人才沿用週一至週五
    const schedules = await prisma.schedule.findMany({
      where: {
        workDate: { gte: firstDate, lte: lastDate },
        ...scopeFilter,
      },
      select: {
        employeeId: true,
        workDate: true,
        shiftType: true,
        startTime: true,
        endTime: true,
        breakTime: true,
        workHours: true,
      },
    });

    const schedulesByEmployee = new Map<number, LeaveDurationScheduleMap>();
    const workingDatesByEmployee = new Map<number, string[]>();
    for (const schedule of schedules) {
      const byDate = schedulesByEmployee.get(schedule.employeeId) ?? {};
      byDate[schedule.workDate] = {
        shiftType: schedule.shiftType,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        breakTime: schedule.breakTime,
        workHours: schedule.workHours,
      };
      schedulesByEmployee.set(schedule.employeeId, byDate);

      if (isWorkingSchedule(schedule)) {
        const dates = workingDatesByEmployee.get(schedule.employeeId) ?? [];
        dates.push(schedule.workDate);
        workingDatesByEmployee.set(schedule.employeeId, dates);
      }
    }

    const weekdayDates: string[] = [];
    if (cutoffDate) {
      for (let day = 1; day <= daysInMonth; day++) {
        const date = `${monthPrefix}-${pad2(day)}`;
        if (date > cutoffDate) break;
        const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) weekdayDates.push(date);
      }
    }

    // 計算今日打卡狀況（使用台灣時區）
    const todayStart = getTaiwanTodayStart(todayNow);
    const todayEnd = getTaiwanTodayEnd(todayNow);
    const todayRecords = await prisma.attendanceRecord.findMany({
      where: {
        workDate: {
          gte: todayStart,
          lt: todayEnd,
        },
        ...scopeFilter,
      }
    });

    const clockedInToday = new Set(
      todayRecords.filter(r => r.clockInTime).map(r => r.employeeId)
    ).size;
    const clockedOutToday = new Set(
      todayRecords.filter(r => r.clockOutTime).map(r => r.employeeId)
    ).size;

    // 出勤率：全站、部門、每日趨勢都用同一組「在職員工 × 應到班日」，分子只算落在這組班日內的上班打卡
    const clockedInKeys = new Set<string>();
    for (const record of attendanceRecords) {
      if (record.clockInTime) clockedInKeys.add(`${record.employeeId}|${toTaiwanDateStr(record.workDate)}`);
    }

    let expectedShifts = 0;
    let attendedShifts = 0;
    const dayStats = new Map<string, { count: number; total: number }>();
    const departmentStats = new Map<string, { total: number; expected: number; attended: number }>();

    for (const employee of employees) {
      const departmentName = employee.department || '未分配';
      const department = departmentStats.get(departmentName) ?? { total: 0, expected: 0, attended: 0 };
      department.total += 1;

      // 本月有任何班表紀錄（含休假日）就依實際排班；完全沒有班表才沿用週一至週五
      const scheduledDates = schedulesByEmployee.has(employee.id)
        ? workingDatesByEmployee.get(employee.id) ?? []
        : weekdayDates;
      for (const date of scheduledDates) {
        if (!cutoffDate || date > cutoffDate) continue;

        const day = dayStats.get(date) ?? { count: 0, total: 0 };
        day.total += 1;
        department.expected += 1;
        expectedShifts += 1;
        if (clockedInKeys.has(`${employee.id}|${date}`)) {
          day.count += 1;
          department.attended += 1;
          attendedShifts += 1;
        }
        dayStats.set(date, day);
      }
      departmentStats.set(departmentName, department);
    }

    const attendanceRate = expectedShifts > 0
      ? Math.round((attendedShifts / expectedShifts) * 100 * 10) / 10
      : 0;

    const dailyAttendance = [...dayStats.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, { count, total }]) => ({ date, count, total }));

    const departmentAttendance = [...departmentStats.entries()].map(([department, stat]) => ({
      department,
      total: stat.total,
      attended: stat.attended,
      rate: stat.expected > 0 ? Math.round((stat.attended / stat.expected) * 100) : 0,
    }));

    // 取得加班統計
    const overtimeRequests = await prisma.overtimeRequest.findMany({
      where: {
        overtimeDate: {
          gte: monthStart,
          lt: nextMonthStart,
        },
        status: 'APPROVED',
        ...scopeFilter,
      }
    });

    // 打卡認列時數（有實際打卡且符合規則的部分）與核准申請時數是兩件事，分開回傳
    const overtimeEligibility = await calculateOvertimeRequestsEligibility(overtimeRequests);
    const totalOvertimeHours = overtimeEligibility.totalEffectiveHours;
    const approvedOvertimeHours = round2(overtimeRequests.reduce((sum, r) => sum + (r.totalHours || 0), 0));
    const avgOvertimePerEmployee = totalEmployees > 0
      ? Math.round((totalOvertimeHours / totalEmployees) * 10) / 10
      : 0;

    // 取得請假統計：與本月有交集的核准假單，件數與本月使用時數（跨月假單兩個月各算各的時數）
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        startDate: { lt: nextMonthStart },
        endDate: { gt: monthStart },
        status: 'APPROVED',
        ...scopeFilter,
      }
    });

    const leaveByType: Record<string, number> = {};
    const leaveHoursByType: Record<string, number> = {};
    for (const leave of leaveRequests) {
      leaveByType[leave.leaveType] = (leaveByType[leave.leaveType] || 0) + 1;
      leaveHoursByType[leave.leaveType] = round2(
        (leaveHoursByType[leave.leaveType] || 0)
        + getLeaveHoursInMonth(leave, schedulesByEmployee.get(leave.employeeId), monthPrefix)
      );
    }

    // 取得待審核項目數（初審與管理員複核都算，範圍同可見員工）
    const pendingLeaves = await prisma.leaveRequest.count({
      where: {
        status: { in: PENDING_STATUSES },
        ...scopeFilter,
      }
    });

    const pendingOvertimes = await prisma.overtimeRequest.count({
      where: {
        status: { in: PENDING_STATUSES },
        ...scopeFilter,
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        // workDays：本月（截至統計日）至少有一人應到班的日數，也就是每日趨勢的天數
        period: { year, month, workDays: dailyAttendance.length },
        summary: {
          totalEmployees,
          attendanceRate,
          expectedShifts,
          attendedShifts,
          totalOvertimeHours,
          avgOvertimePerEmployee,
          pendingApprovals: pendingLeaves + pendingOvertimes
        },
        today: {
          date: toTaiwanDateStr(todayNow),
          clockedIn: clockedInToday,
          clockedOut: clockedOutToday,
          notClockedIn: totalEmployees - clockedInToday
        },
        overtime: {
          totalHours: totalOvertimeHours,
          approvedHours: approvedOvertimeHours,
          requestCount: overtimeRequests.length,
          avgPerEmployee: avgOvertimePerEmployee
        },
        leave: {
          totalRequests: leaveRequests.length,
          byType: leaveByType,
          hoursByType: leaveHoursByType,
          pending: pendingLeaves
        },
        trends: {
          dailyAttendance
        },
        departments: departmentAttendance
      }
    });
  } catch (error) {
    console.error('取得儀表板統計失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
