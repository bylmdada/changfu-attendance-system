import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { getTaiwanTodayEnd, getTaiwanTodayStart, toTaiwanDateStr } from '@/lib/timezone';
import { calculateAttendanceHours, getScheduledAttendanceTiming } from '@/lib/work-hours';
import {
  indexApprovedOvertimeRequests,
  resolveAttendanceOvertimeType,
  resolveApprovedAttendanceOvertime,
} from '@/lib/approved-overtime';
import { getStoredOvertimeCalculationSettings } from '@/lib/overtime-settings';
import { getAttendanceRegularTimeExclusions } from '@/lib/attendance-leave-hours';

const NON_WORKING_SHIFT_TYPES = new Set(['NH', 'RD', 'rd', 'FDL', 'OFF', 'TD']);
const ABSENT_GRACE_MINUTES = 15;

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

    const attendanceLeaves = todayRecord
      ? await prisma.leaveRequest.findMany({
          where: {
            employeeId: user.employee.id,
            voidedAt: null,
            OR: [
              { status: 'APPROVED' },
              { status: 'PENDING_ADMIN', managerOpinion: 'AGREE' },
            ],
            startDate: { lt: todayEnd },
            endDate: { gt: todayStart },
          },
          select: {
            startDate: true,
            endDate: true,
            status: true,
            managerOpinion: true,
            voidedAt: true,
          },
        })
      : [];

    // 計算工作時數
    const hours = calculateAttendanceHours(
      todayRecord?.clockInTime,
      todayRecord?.clockOutTime,
      todaySchedule?.workHours ?? undefined,
      todaySchedule?.breakTime || 0,
      {
        startTime: todaySchedule?.startTime,
        endTime: todaySchedule?.endTime,
        workDate: todayStart,
        regularTimeExclusions: getAttendanceRegularTimeExclusions(attendanceLeaves),
      }
    );
    let workHours = hours.regularHours;
    let overtimeHours = hours.overtimeHours;

    if (todayRecord) {
      const [overtimeSettings, approvedOvertimeRequests] = await Promise.all([
        getStoredOvertimeCalculationSettings(),
        prisma.overtimeRequest.findMany({
          where: {
            employeeId: user.employee.id,
            status: 'APPROVED',
            overtimeDate: {
              gte: todayStart,
              lt: todayEnd,
            },
          },
          select: {
            id: true,
            employeeId: true,
            overtimeDate: true,
            totalHours: true,
            compensationType: true,
          },
        }),
      ]);
      const resolvedOvertime = resolveApprovedAttendanceOvertime(
        {
          employeeId: user.employee.id,
          workDate: todayRecord.workDate,
          regularHours: hours.regularHours,
          actualWorkHours: hours.totalHours,
          overtimeHours: hours.overtimeHours,
          clockInOvertimeId: todayRecord.clockInOvertimeId,
          clockOutOvertimeId: todayRecord.clockOutOvertimeId,
          overtimeType: resolveAttendanceOvertimeType({
            shiftType: todaySchedule?.shiftType,
            workDate: todayRecord.workDate,
          }),
        },
        indexApprovedOvertimeRequests(approvedOvertimeRequests),
        overtimeSettings.overtimeMinUnit
      );
      workHours = resolvedOvertime.regularHours;
      overtimeHours = resolvedOvertime.effectiveHours;
    }

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
      const [todayClockedInRecords, todayAttendanceRecords] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: {
            ...todayAttendanceWhere,
            clockInTime: { not: null },
            employee: {
              isActive: true,
            },
          },
          select: {
            employeeId: true,
          },
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
      const todayAttendanceCount = new Set(todayClockedInRecords.map(record => record.employeeId)).size;
      const attendanceByEmployeeId = new Map(todayAttendanceRecords.map(record => [record.employeeId, record]));
      const currentTaiwanMinutes = getScheduledAttendanceTiming({
        clockInTime: now,
        schedule: { workDate: todayStr, startTime: '00:00', endTime: '23:59' },
      }).lateMinutes;
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
          const timing = getScheduledAttendanceTiming({
            clockInTime: attendanceRecord.clockInTime,
            clockOutTime: attendanceRecord.clockOutTime,
            schedule: {
              workDate: todayStr,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
            },
          });
          if (timing.isLate) {
            lateCount++;
          }
          continue;
        }

        if (!attendanceRecord?.clockOutTime && currentTaiwanMinutes >= scheduleStartMinutes + ABSENT_GRACE_MINUTES) {
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
