import type { Prisma } from '@prisma/client';
import { calculateAttendanceHours } from '@/lib/work-hours';
import { getTaiwanDayStart, toTaiwanDateStr } from '@/lib/timezone';
import { getAttendanceRegularTimeExclusions } from '@/lib/attendance-leave-hours';
import {
  indexApprovedOvertimeRequests,
  resolveAttendanceOvertimeType,
  resolveApprovedAttendanceOvertime,
} from '@/lib/approved-overtime';

type AttendanceRecordForMissedClock = {
  id: number;
  workDate: Date;
  clockInTime: Date | null;
  clockOutTime: Date | null;
};

type MissedClockAttendanceClient = Pick<
  Prisma.TransactionClient,
  'attendanceRecord' | 'schedule' | 'leaveRequest' | 'overtimeRequest'
>;

function parseYmd(value: string | Date) {
  const ymd = value instanceof Date ? toTaiwanDateStr(value) : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error('工作日期格式錯誤');

  return {
    ymd,
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function getMissedClockWorkDate(value: string | Date) {
  const { year, month, day } = parseYmd(value);
  return getTaiwanDayStart(year, month, day);
}

export function getMissedClockDateTime(workDate: string | Date, requestedTime: string) {
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(requestedTime);
  if (!timeMatch) throw new Error('補卡時間格式錯誤');

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('補卡時間格式錯誤');
  }

  return new Date(getMissedClockWorkDate(workDate).getTime() + (hour * 60 + minute) * 60 * 1000);
}

async function buildHoursUpdate(
  client: MissedClockAttendanceClient,
  employeeId: number,
  workDate: string,
  attendance: Pick<AttendanceRecordForMissedClock, 'workDate' | 'clockInTime' | 'clockOutTime'>
) {
  if (!attendance.clockInTime || !attendance.clockOutTime) {
    return { regularHours: 0, overtimeHours: 0 };
  }

  const dayStart = getMissedClockWorkDate(workDate);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const [schedule, attendanceLeaves, approvedOvertimeRequests] = await Promise.all([
    client.schedule.findFirst({
      where: { employeeId, workDate },
    }),
    client.leaveRequest.findMany({
      where: {
        employeeId,
        voidedAt: null,
        OR: [
          { status: 'APPROVED' },
          { status: 'PENDING_ADMIN', managerOpinion: 'AGREE' },
        ],
        startDate: { lt: dayEnd },
        endDate: { gt: dayStart },
      },
      select: {
        startDate: true,
        endDate: true,
        status: true,
        managerOpinion: true,
        voidedAt: true,
      },
    }),
    client.overtimeRequest.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        overtimeDate: { gte: dayStart, lt: dayEnd },
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
  const hours = calculateAttendanceHours(
    attendance.clockInTime,
    attendance.clockOutTime,
    schedule?.workHours ?? undefined,
    schedule?.breakTime || 0,
    {
      startTime: schedule?.startTime,
      endTime: schedule?.endTime,
      workDate: attendance.workDate,
      regularTimeExclusions: getAttendanceRegularTimeExclusions(attendanceLeaves),
    }
  );
  const resolvedOvertime = resolveApprovedAttendanceOvertime(
    {
      employeeId,
      workDate: attendance.workDate,
      regularHours: hours.regularHours,
      actualWorkHours: hours.totalHours,
      overtimeHours: hours.overtimeHours,
      overtimeType: resolveAttendanceOvertimeType({
        shiftType: schedule?.shiftType,
        workDate: attendance.workDate,
      }),
    },
    indexApprovedOvertimeRequests(approvedOvertimeRequests),
    0
  );

  return {
    regularHours: resolvedOvertime.regularHours,
    overtimeHours: resolvedOvertime.effectiveHours,
  };
}

export async function applyMissedClockToAttendance(
  client: MissedClockAttendanceClient,
  request: {
    employeeId: number;
    workDate: string | Date;
    clockType: string;
    requestedTime: string;
  }
) {
  const { ymd } = parseYmd(request.workDate);
  const workDate = getMissedClockWorkDate(request.workDate);
  const clockTime = getMissedClockDateTime(request.workDate, request.requestedTime);
  const existing = await client.attendanceRecord.findFirst({
    where: {
      employeeId: request.employeeId,
      workDate,
    },
  });

  const clockData = request.clockType === 'CLOCK_IN'
    ? { clockInTime: clockTime }
    : { clockOutTime: clockTime };
  const nextAttendance = {
    workDate,
    clockInTime: request.clockType === 'CLOCK_IN' ? clockTime : existing?.clockInTime ?? null,
    clockOutTime: request.clockType === 'CLOCK_OUT' ? clockTime : existing?.clockOutTime ?? null,
  };
  const hoursData = await buildHoursUpdate(client, request.employeeId, ymd, nextAttendance);

  if (existing) {
    return client.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        ...clockData,
        ...hoursData,
      },
    });
  }

  return client.attendanceRecord.create({
    data: {
      employeeId: request.employeeId,
      workDate,
      status: 'PRESENT',
      ...clockData,
      ...hoursData,
    },
  });
}

export async function removeMissedClockFromAttendance(
  client: MissedClockAttendanceClient,
  request: {
    employeeId: number;
    workDate: string | Date;
    clockType: string;
    requestedTime: string;
  }
) {
  const { ymd } = parseYmd(request.workDate);
  const workDate = getMissedClockWorkDate(request.workDate);
  const clockTime = getMissedClockDateTime(request.workDate, request.requestedTime);
  const existing = await client.attendanceRecord.findFirst({
    where: {
      employeeId: request.employeeId,
      workDate,
    },
  });

  if (!existing) return null;

  const target = request.clockType === 'CLOCK_IN' ? existing.clockInTime : existing.clockOutTime;
  if (!target || target.getTime() !== clockTime.getTime()) {
    return existing;
  }

  const nextAttendance = {
    workDate,
    clockInTime: request.clockType === 'CLOCK_IN' ? null : existing.clockInTime,
    clockOutTime: request.clockType === 'CLOCK_OUT' ? null : existing.clockOutTime,
  };
  const hoursData = await buildHoursUpdate(client, request.employeeId, ymd, nextAttendance);

  return client.attendanceRecord.update({
    where: { id: existing.id },
    data: {
      ...(request.clockType === 'CLOCK_IN' ? { clockInTime: null } : { clockOutTime: null }),
      ...hoursData,
    },
  });
}
