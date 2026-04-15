import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { getTaiwanTodayEnd, getTaiwanTodayStart, toTaiwanDateStr } from '@/lib/timezone';

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
    let workHours = 0;
    let overtimeHours = 0;
    
    if (todayRecord && todayRecord.clockInTime && todayRecord.clockOutTime) {
      const clockIn = new Date(todayRecord.clockInTime);
      const clockOut = new Date(todayRecord.clockOutTime);
      const totalMinutes = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60);
      
      if (totalMinutes > 0) {
        // 扣除休息時間 (假設1小時)
        const workMinutes = Math.max(0, totalMinutes - 60);
        workHours = Math.round((workMinutes / 60) * 100) / 100;
        
        // 計算加班時數 (超過8小時的部分)
        if (workHours > 8) {
          overtimeHours = Math.round((workHours - 8) * 100) / 100;
          workHours = 8;
        }
      }
    }

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
            endTime: todaySchedule.endTime
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
            totalHours: workHours + overtimeHours
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
          endTime: todaySchedule.endTime
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
          totalHours: workHours + overtimeHours
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
