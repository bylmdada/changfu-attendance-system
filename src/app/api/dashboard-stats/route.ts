import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';

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

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString());

    // 計算月份日期範圍
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    // 取得所有在職員工數
    const totalEmployees = await prisma.employee.count({
      where: {
        isActive: true,
        ...(employeeScope || {}),
      }
    });

    // 取得本月考勤記錄
    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        workDate: {
          gte: startDate,
          lte: endDate
        },
        ...(employeeScope ? { employee: employeeScope } : {}),
      },
      include: {
        employee: {
          select: { id: true, name: true, department: true }
        }
      }
    });

    // 計算工作日數（排除週末）
    let workDays = 0;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workDays++;
      }
    }

    // 計算今日打卡狀況（使用台灣時區）
    const todayNow = new Date();
    const taiwanToday = new Date(todayNow.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const today = new Date(Date.UTC(taiwanToday.getFullYear(), taiwanToday.getMonth(), taiwanToday.getDate()) - 8 * 60 * 60 * 1000);
    const todayRecords = await prisma.attendanceRecord.findMany({
      where: {
        workDate: today,
        ...(employeeScope ? { employee: employeeScope } : {}),
      }
    });

    const clockedInToday = todayRecords.filter(r => r.clockInTime).length;
    const clockedOutToday = todayRecords.filter(r => r.clockOutTime).length;

    // 計算出勤率
    const expectedAttendance = totalEmployees * workDays;
    const actualAttendance = attendanceRecords.filter(r => r.clockInTime).length;
    const attendanceRate = expectedAttendance > 0 
      ? Math.round((actualAttendance / expectedAttendance) * 100 * 10) / 10 
      : 0;

    // 取得加班統計
    const overtimeRequests = await prisma.overtimeRequest.findMany({
      where: {
        overtimeDate: {
          gte: startDate,
          lte: endDate
        },
        status: 'APPROVED',
        ...(employeeScope ? { employee: employeeScope } : {}),
      }
    });

    const totalOvertimeHours = overtimeRequests.reduce((sum, r) => sum + r.totalHours, 0);
    const avgOvertimePerEmployee = totalEmployees > 0 
      ? Math.round((totalOvertimeHours / totalEmployees) * 10) / 10 
      : 0;

    // 取得請假統計
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        status: 'APPROVED',
        ...(employeeScope ? { employee: employeeScope } : {}),
      }
    });

    const leaveByType = leaveRequests.reduce((acc, r) => {
      acc[r.leaveType] = (acc[r.leaveType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // 取得待審核項目數
    const pendingLeaves = await prisma.leaveRequest.count({
      where: {
        status: 'PENDING',
        ...(employeeScope ? { employee: employeeScope } : {}),
      }
    });

    const pendingOvertimes = await prisma.overtimeRequest.count({
      where: {
        status: 'PENDING',
        ...(employeeScope ? { employee: employeeScope } : {}),
      }
    });

    // 取得每日出勤趨勢（本月每天的打卡人數）
    const dailyAttendance = [];
    for (let d = new Date(startDate); d <= endDate && d <= new Date(); d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dayRecords = attendanceRecords.filter(r => {
          const recordDate = new Date(r.workDate);
          return recordDate.toDateString() === d.toDateString();
        });
        dailyAttendance.push({
          date: new Date(d).toISOString().split('T')[0],
          count: dayRecords.filter(r => r.clockInTime).length,
          total: totalEmployees
        });
      }
    }

    // 取得部門出勤統計
    const departmentStats = await prisma.employee.groupBy({
      by: ['department'],
      where: {
        isActive: true,
        ...(employeeScope || {}),
      },
      _count: { id: true }
    });

    const departmentAttendance = await Promise.all(
      departmentStats.map(async (dept) => {
        const deptRecords = attendanceRecords.filter(
          r => r.employee.department === dept.department
        );
        const attendedCount = deptRecords.filter(r => r.clockInTime).length;

        return {
          department: dept.department || '未分配',
          total: dept._count.id,
          attended: attendedCount,
          rate: dept._count.id > 0 
            ? Math.round((attendedCount / (dept._count.id * workDays)) * 100) 
            : 0
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        period: { year, month, workDays },
        summary: {
          totalEmployees,
          attendanceRate,
          totalOvertimeHours,
          avgOvertimePerEmployee,
          pendingApprovals: pendingLeaves + pendingOvertimes
        },
        today: {
          date: `${taiwanToday.getFullYear()}-${String(taiwanToday.getMonth() + 1).padStart(2, '0')}-${String(taiwanToday.getDate()).padStart(2, '0')}`,
          clockedIn: clockedInToday,
          clockedOut: clockedOutToday,
          notClockedIn: totalEmployees - clockedInToday
        },
        overtime: {
          totalHours: totalOvertimeHours,
          requestCount: overtimeRequests.length,
          avgPerEmployee: avgOvertimePerEmployee
        },
        leave: {
          totalRequests: leaveRequests.length,
          byType: leaveByType,
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
