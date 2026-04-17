import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { getTaiwanTodayEnd, getTaiwanTodayStart, toTaiwanDateStr } from '@/lib/timezone';
import { calculateAttendanceHours } from '@/lib/work-hours';

export async function GET(request: NextRequest) {
  try {
    const userPayload = await getUserFromRequest(request);
    if (!userPayload) {
      return NextResponse.json({ error: '需要登入' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userPayload.userId },
      include: {
        employee: true
      }
    });

    if (!user || !user.isActive || !user.employee) {
      return NextResponse.json({ error: '需要登入' }, { status: 401 });
    }

    const now = new Date();
    const todayStart = getTaiwanTodayStart(now);
    const todayEnd = getTaiwanTodayEnd(now);
    const todayStr = toTaiwanDateStr(now);

    // 查詢今日考勤記錄
    const todayRecord = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: {
          gte: todayStart,
          lt: todayEnd
        }
      }
    });

    // 查詢今日排班資訊
    const todaySchedule = await prisma.schedule.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: todayStr
      }
    });

    // 計算工作時數
    const hours = calculateAttendanceHours(
      todayRecord?.clockInTime,
      todayRecord?.clockOutTime,
      undefined,
      todaySchedule?.breakTime || 0
    );
    const workHours = hours.regularHours;
    const overtimeHours = hours.overtimeHours;

    // 只有具備管理權限的角色才能取得全公司今日出勤統計
    if (user.role === 'ADMIN' || user.role === 'HR') {
      const todayAttendanceCount = await prisma.attendanceRecord.count({
        where: {
          workDate: {
            gte: todayStart,
            lt: todayEnd
          },
          status: 'PRESENT'
        }
      });

      return NextResponse.json({
        success: true,
        attendanceCount: todayAttendanceCount,
        data: {
          date: todayStr,
          employee: {
            name: user.employee.name,
            employeeId: user.employee.employeeId,
            department: user.employee.department
          },
          schedule: todaySchedule ? {
            shiftType: todaySchedule.shiftType,
            startTime: todaySchedule.startTime,
            endTime: todaySchedule.endTime,
            breakTime: todaySchedule.breakTime
          } : null,
          attendance: todayRecord ? {
            clockInTime: todayRecord.clockInTime?.toISOString() || null,
            clockOutTime: todayRecord.clockOutTime?.toISOString() || null,
            status: todayRecord.status,
            notes: todayRecord.notes
          } : null,
          workSummary: {
            regularHours: workHours,
            overtimeHours: overtimeHours,
            totalHours: hours.totalHours
          }
        }
      });
    }

    // 一般員工回傳個人資料
    return NextResponse.json({
      success: true,
      data: {
        date: todayStr,
        employee: {
          name: user.employee.name,
          employeeId: user.employee.employeeId,
          department: user.employee.department
        },
        schedule: todaySchedule ? {
          shiftType: todaySchedule.shiftType,
          startTime: todaySchedule.startTime,
          endTime: todaySchedule.endTime,
          breakTime: todaySchedule.breakTime
        } : null,
        attendance: todayRecord ? {
          clockInTime: todayRecord.clockInTime?.toISOString() || null,
          clockOutTime: todayRecord.clockOutTime?.toISOString() || null,
          status: todayRecord.status,
          notes: todayRecord.notes
        } : null,
        workSummary: {
          regularHours: workHours,
          overtimeHours: overtimeHours,
          totalHours: hours.totalHours
        }
      }
    });

  } catch (error) {
    console.error('取得今日考勤摘要失敗:', error);
    return NextResponse.json(
      { error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}
