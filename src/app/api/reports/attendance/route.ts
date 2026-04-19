import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';

function validateIntegerQueryParam(
  value: string | null,
  fieldName: string,
  options: { min?: number; max?: number; optional?: boolean } = {}
) {
  if (value === null) {
    return { value: null as number | null, error: options.optional ? null : `缺少${fieldName}參數` };
  }

  if (!/^\d+$/.test(value)) {
    return { value: null as number | null, error: `無效的${fieldName}參數` };
  }

  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue)) {
    return { value: null as number | null, error: `無效的${fieldName}參數` };
  }

  if (
    (options.min !== undefined && parsedValue < options.min) ||
    (options.max !== undefined && parsedValue > options.max)
  ) {
    return { value: null as number | null, error: `無效的${fieldName}參數` };
  }

  return { value: parsedValue, error: null };
}

function toTaiwanClockTime(date: Date) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

// GET - 匯出月度考勤報表 (JSON 格式，前端生成 PDF)
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

    if (!decoded || !['ADMIN', 'HR', 'SUPERVISOR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理權限' }, { status: 403 });
    }

    const hasFullAccess = decoded.role === 'ADMIN' || decoded.role === 'HR';
    const manageableDepartments = hasFullAccess ? [] : await getManageableDepartments(decoded);

    if (!hasFullAccess && manageableDepartments.length === 0) {
      return NextResponse.json({ error: '無權限查看考勤報表' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearResult = validateIntegerQueryParam(searchParams.get('year'), '年份', {
      min: 1900,
      max: 9999,
      optional: true,
    });
    if (yearResult.error) {
      return NextResponse.json({ error: yearResult.error }, { status: 400 });
    }

    const monthResult = validateIntegerQueryParam(searchParams.get('month'), '月份', {
      min: 1,
      max: 12,
      optional: true,
    });
    if (monthResult.error) {
      return NextResponse.json({ error: monthResult.error }, { status: 400 });
    }

    const employeeIdResult = validateIntegerQueryParam(searchParams.get('employeeId'), '員工編號', {
      min: 1,
      optional: true,
    });
    if (employeeIdResult.error) {
      return NextResponse.json({ error: employeeIdResult.error }, { status: 400 });
    }

    const now = new Date();
    const year = yearResult.value ?? now.getFullYear();
    const month = monthResult.value ?? (now.getMonth() + 1);
    const department = searchParams.get('department');

    // 計算月份日期範圍
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    // 取得員工資料
    const employeeWhere: Record<string, unknown> = { isActive: true };
    if (employeeIdResult.value !== null) {
      employeeWhere.id = employeeIdResult.value;
    }
    if (hasFullAccess && department) {
      employeeWhere.department = department;
    } else if (!hasFullAccess) {
      if (department) {
        if (!manageableDepartments.includes(department)) {
          return NextResponse.json({ error: '無權限查看其他部門的考勤報表' }, { status: 403 });
        }
        employeeWhere.department = department;
      } else {
        employeeWhere.department = { in: manageableDepartments };
      }
    }

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      orderBy: [{ department: 'asc' }, { name: 'asc' }]
    });

    const scopedEmployeeIds = employees.map((employee) => employee.id);
    const employeeIdFilter = { in: scopedEmployeeIds.length > 0 ? scopedEmployeeIds : [0] };

    // 取得考勤記錄
    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        workDate: {
          gte: startDate,
          lte: endDate
        },
        employeeId: employeeIdFilter
      },
      include: {
        employee: {
          select: { id: true, employeeId: true, name: true, department: true, position: true }
        }
      },
      orderBy: [{ workDate: 'asc' }]
    });

    // 取得請假記錄
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        OR: [
          { startDate: { lte: endDate }, endDate: { gte: startDate } }
        ],
        employeeId: employeeIdFilter
      },
      include: {
        employee: {
          select: { id: true, name: true }
        }
      }
    });

    // 取得加班記錄
    const overtimeRequests = await prisma.overtimeRequest.findMany({
      where: {
        status: 'APPROVED',
        overtimeDate: {
          gte: startDate,
          lte: endDate
        },
        employeeId: employeeIdFilter
      },
      include: {
        employee: {
          select: { id: true, name: true }
        }
      }
    });

    // 計算工作日數
    let workDays = 0;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workDays++;
      }
    }

    // 組織報表資料
    const reportData = employees.map(emp => {
      const empAttendance = attendanceRecords.filter(r => r.employeeId === emp.id);
      const empLeaves = leaveRequests.filter(r => r.employeeId === emp.id);
      const empOvertime = overtimeRequests.filter(r => r.employeeId === emp.id);

      // 計算出勤天數
      const attendedDays = empAttendance.filter(r => r.clockInTime).length;
      
      // 計算遲到次數
      const lateDays = empAttendance.filter(r => {
        if (!r.clockInTime) return false;
        const clockIn = toTaiwanClockTime(new Date(r.clockInTime));
        return clockIn.getHours() > 9 || (clockIn.getHours() === 9 && clockIn.getMinutes() > 0);
      }).length;

      // 計算早退次數
      const earlyLeaveDays = empAttendance.filter(r => {
        if (!r.clockOutTime) return false;
        const clockOut = toTaiwanClockTime(new Date(r.clockOutTime));
        return clockOut.getHours() < 18;
      }).length;

      // 計算總工時（根據打卡時間計算）
      const totalWorkHours = empAttendance.reduce((sum, r) => {
        if (r.clockInTime && r.clockOutTime) {
          const clockIn = new Date(r.clockInTime);
          const clockOut = new Date(r.clockOutTime);
          const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
          return sum + Math.max(0, hours);
        }
        return sum;
      }, 0);

      // 計算加班時數
      const totalOvertimeHours = empOvertime.reduce((sum, r) => sum + r.totalHours, 0);

      // 計算請假天數
      const totalLeaveDays = empLeaves.reduce((sum, r) => sum + (r.totalDays || 0), 0);

      return {
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department || '未分配',
        position: emp.position || '未設定',
        attendedDays,
        lateDays,
        earlyLeaveDays,
        totalWorkHours: Math.round(totalWorkHours * 10) / 10,
        totalOvertimeHours,
        totalLeaveDays,
        attendanceRate: workDays > 0 ? Math.round((attendedDays / workDays) * 100) : 0,
        dailyRecords: empAttendance.map(r => {
          // 計算單日工時
          let dailyHours = 0;
          if (r.clockInTime && r.clockOutTime) {
            const clockIn = new Date(r.clockInTime);
            const clockOut = new Date(r.clockOutTime);
            dailyHours = Math.round((clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60) * 10) / 10;
          }
          return {
            date: r.workDate,
            clockIn: r.clockInTime,
            clockOut: r.clockOutTime,
            workHours: dailyHours,
            status: r.status,
            note: r.notes
          };
        })
      };
    });

    return NextResponse.json({
      success: true,
      report: {
        title: `${year}年${month}月 考勤報表`,
        period: { year, month, startDate, endDate, workDays },
        generatedAt: new Date().toISOString(),
        generatedBy: decoded.username,
        summary: {
          totalEmployees: employees.length,
          avgAttendanceRate: reportData.length > 0 
            ? Math.round(reportData.reduce((sum, r) => sum + r.attendanceRate, 0) / reportData.length)
            : 0,
          totalOvertimeHours: reportData.reduce((sum, r) => sum + r.totalOvertimeHours, 0),
          totalLeaveDays: reportData.reduce((sum, r) => sum + r.totalLeaveDays, 0)
        },
        employees: reportData
      }
    });
  } catch (error) {
    console.error('匯出考勤報表失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
