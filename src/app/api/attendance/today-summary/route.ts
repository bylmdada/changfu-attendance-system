import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { getTaiwanTodayEnd, getTaiwanTodayStart, toTaiwanDate, toTaiwanDateStr } from '@/lib/timezone';
import { calculateAttendanceHours } from '@/lib/work-hours';

const NON_WORKING_SHIFT_TYPES = new Set(['NH', 'RD', 'rd', 'FDL', 'OFF', 'TD']);

function parseTimeToMinutes(time?: string | null) {
  if (!time) {
    return null;
  }

  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function getTaiwanTimeMinutes(date: Date) {
  const taiwanDate = toTaiwanDate(date);
  return taiwanDate.getHours() * 60 + taiwanDate.getMinutes();
}

function isWorkingSchedule(schedule: { shiftType: string; startTime: string; endTime: string }) {
  return !NON_WORKING_SHIFT_TYPES.has(schedule.shiftType) && Boolean(schedule.startTime && schedule.endTime);
}

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
      const todayAttendanceWhere = {
        workDate: {
          gte: todayStart,
          lt: todayEnd
        }
      };
      const todaySchedules = await prisma.schedule.findMany({
        where: {
          workDate: todayStr,
          employee: {
            isActive: true,
          },
        },
        select: {
          employeeId: true,
          shiftType: true,
          startTime: true,
          endTime: true,
        },
      });
      const scheduledEmployeeIds = [...new Set(todaySchedules.map(schedule => schedule.employeeId))];
      const [todayAttendanceCount, todayAttendanceRecords] = await Promise.all([
        prisma.attendanceRecord.count({
          where: {
            ...todayAttendanceWhere,
            status: 'PRESENT'
          }
        }),
        scheduledEmployeeIds.length > 0
          ? prisma.attendanceRecord.findMany({
              where: {
                ...todayAttendanceWhere,
                employeeId: { in: scheduledEmployeeIds },
              },
              select: {
                employeeId: true,
                clockInTime: true,
                clockOutTime: true,
              },
            })
          : Promise.resolve([]),
      ]);
      const attendanceByEmployeeId = new Map(todayAttendanceRecords.map(record => [record.employeeId, record]));
      const currentTaiwanMinutes = getTaiwanTimeMinutes(now);
      let lateCount = 0;
      let absentCount = 0;

      for (const schedule of todaySchedules) {
        if (!isWorkingSchedule(schedule)) {
          continue;
        }

        const scheduleStartMinutes = parseTimeToMinutes(schedule.startTime);
        if (scheduleStartMinutes === null) {
          continue;
        }

        const attendanceRecord = attendanceByEmployeeId.get(schedule.employeeId);
        if (attendanceRecord?.clockInTime) {
          if (getTaiwanTimeMinutes(attendanceRecord.clockInTime) > scheduleStartMinutes) {
            lateCount++;
          }
          continue;
        }

        if (!attendanceRecord?.clockOutTime && currentTaiwanMinutes >= scheduleStartMinutes) {
          absentCount++;
        }
      }

      return NextResponse.json({
        success: true,
        attendanceCount: todayAttendanceCount,
        lateCount,
        absentCount,
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
