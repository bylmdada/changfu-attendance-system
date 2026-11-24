import type { Prisma, Schedule } from '@prisma/client';
import { calculateAttendanceHours, parseTimeToMinutes } from '@/lib/work-hours';
import {
  getTaiwanDateParts,
  getTaiwanDayStart,
  getTaiwanTimeParts,
  toTaiwanDateStr,
} from '@/lib/timezone';
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

type MissedClockLookupClient = Pick<Prisma.TransactionClient, 'attendanceRecord' | 'schedule'>;

type MissedClockRequestInput = {
  employeeId: number;
  workDate: string | Date;
  clockType: string;
  requestedTime: string;
};

const DAY_MINUTES = 24 * 60;

/** 補登內容無法套用（格式錯誤、補完下班早於上班…）：訊息可直接給申請人／審核者看 */
export class MissedClockTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissedClockTimeError';
  }
}

function parseYmd(value: string | Date) {
  const ymd = value instanceof Date ? toTaiwanDateStr(value) : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new MissedClockTimeError('工作日期格式錯誤');

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

function formatTaiwanDateTime(date: Date) {
  const { month, day } = getTaiwanDateParts(date);
  const { hour, minute } = getTaiwanTimeParts(date);
  return `${month}/${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 補登的實際打卡時間。工作日依班次（夜班下班卡仍歸上班那天），打卡時間保留實際日期。
 * 跨午夜班次（結束 ≤ 開始）的班次窗口是「工作日開始 ～ 隔天結束」，申請人只填時:分，
 * 當天或隔天都有可能，取離班次窗口較近的那一天（窗口內距離為 0）；兩天一樣近時，
 * 上班取當天、下班取隔天。日班或沒有班表維持「工作日 + 時:分」。
 */
export function getMissedClockDateTime(
  workDate: string | Date,
  requestedTime: string,
  clockType?: string,
  schedule?: { startTime?: string | null; endTime?: string | null } | null
) {
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(requestedTime);
  if (!timeMatch) throw new MissedClockTimeError('補卡時間格式錯誤');

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new MissedClockTimeError('補卡時間格式錯誤');
  }

  let minutes = hour * 60 + minute;
  const shiftStart = parseTimeToMinutes(schedule?.startTime);
  const shiftEnd = parseTimeToMinutes(schedule?.endTime);
  if (shiftStart !== null && shiftEnd !== null && shiftEnd <= shiftStart) {
    const windowEnd = shiftEnd + DAY_MINUTES;
    const gapToShift = (m: number) => (m < shiftStart ? shiftStart - m : m > windowEnd ? m - windowEnd : 0);
    const nextDayGap = gapToShift(minutes + DAY_MINUTES);
    const sameDayGap = gapToShift(minutes);
    if (nextDayGap < sameDayGap || (nextDayGap === sameDayGap && clockType !== 'CLOCK_IN')) {
      minutes += DAY_MINUTES;
    }
  }

  return new Date(getMissedClockWorkDate(workDate).getTime() + minutes * 60 * 1000);
}

async function buildHoursUpdate(
  client: MissedClockAttendanceClient,
  employeeId: number,
  workDate: string,
  attendance: Pick<AttendanceRecordForMissedClock, 'workDate' | 'clockInTime' | 'clockOutTime'>,
  schedule: Schedule | null
) {
  if (!attendance.clockInTime || !attendance.clockOutTime) {
    return { regularHours: 0, overtimeHours: 0 };
  }

  const dayStart = getMissedClockWorkDate(workDate);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const [attendanceLeaves, approvedOvertimeRequests] = await Promise.all([
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

/**
 * 補登套用前的檢查與時間解析：讀班表（決定夜班實際日期）與既有考勤，
 * 補完後下班必須晚於上班，否則請申請人確認。核准、批次核准與申請送出共用。
 */
async function resolveMissedClock(client: MissedClockLookupClient, request: MissedClockRequestInput) {
  const { ymd } = parseYmd(request.workDate);
  const workDate = getMissedClockWorkDate(request.workDate);
  const [schedule, existing] = await Promise.all([
    client.schedule.findFirst({ where: { employeeId: request.employeeId, workDate: ymd } }),
    client.attendanceRecord.findFirst({ where: { employeeId: request.employeeId, workDate } }),
  ]);
  const clockTime = getMissedClockDateTime(request.workDate, request.requestedTime, request.clockType, schedule);
  const clockInTime = request.clockType === 'CLOCK_IN' ? clockTime : existing?.clockInTime ?? null;
  const clockOutTime = request.clockType === 'CLOCK_IN' ? existing?.clockOutTime ?? null : clockTime;

  if (clockInTime && clockOutTime && clockOutTime.getTime() <= clockInTime.getTime()) {
    throw new MissedClockTimeError(
      `補登後下班時間（${formatTaiwanDateTime(clockOutTime)}）不晚於上班時間（${formatTaiwanDateTime(clockInTime)}），` +
      '請申請人確認補登的時間與工作日期（夜班跨日請選上班那天為工作日期）'
    );
  }

  return { ymd, workDate, schedule, existing, clockTime, clockInTime, clockOutTime };
}

export async function validateMissedClockRequest(client: MissedClockLookupClient, request: MissedClockRequestInput) {
  await resolveMissedClock(client, request);
}

export async function applyMissedClockToAttendance(
  client: MissedClockAttendanceClient,
  request: MissedClockRequestInput
) {
  const { ymd, workDate, schedule, existing, clockTime, clockInTime, clockOutTime } =
    await resolveMissedClock(client, request);
  const clockData = request.clockType === 'CLOCK_IN'
    ? { clockInTime: clockTime }
    : { clockOutTime: clockTime };
  const hoursData = await buildHoursUpdate(
    client,
    request.employeeId,
    ymd,
    { workDate, clockInTime, clockOutTime },
    schedule
  );

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
  request: MissedClockRequestInput
) {
  const { ymd } = parseYmd(request.workDate);
  const workDate = getMissedClockWorkDate(request.workDate);
  const [schedule, existing] = await Promise.all([
    client.schedule.findFirst({ where: { employeeId: request.employeeId, workDate: ymd } }),
    client.attendanceRecord.findFirst({ where: { employeeId: request.employeeId, workDate } }),
  ]);

  if (!existing) return null;

  // 夜班補登的實際時間在工作日隔天，之後班表又可能被改過，所以不看現在的班表，
  // 工作日當天與隔天的同一個時:分都算「這次補登寫的」。兩個都對不上，代表這個時間
  // 之後被更正過，不是這次補登，不能清掉。
  const sameDay = getMissedClockDateTime(request.workDate, request.requestedTime).getTime();
  const target = request.clockType === 'CLOCK_IN' ? existing.clockInTime : existing.clockOutTime;
  if (!target || (target.getTime() !== sameDay && target.getTime() !== sameDay + DAY_MINUTES * 60 * 1000)) {
    return existing;
  }

  const nextAttendance = {
    workDate,
    clockInTime: request.clockType === 'CLOCK_IN' ? null : existing.clockInTime,
    clockOutTime: request.clockType === 'CLOCK_OUT' ? null : existing.clockOutTime,
  };
  const hoursData = await buildHoursUpdate(client, request.employeeId, ymd, nextAttendance, schedule);

  return client.attendanceRecord.update({
    where: { id: existing.id },
    data: {
      ...(request.clockType === 'CLOCK_IN' ? { clockInTime: null } : { clockOutTime: null }),
      ...hoursData,
    },
  });
}
