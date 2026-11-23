import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/database';
import { parseIntegerQueryParam } from '@/lib/query-params';
import {
  getTaiwanDayEnd,
  getTaiwanDayStart,
  getTaiwanMonthEnd,
  getTaiwanMonthStart,
  toTaiwanDateStr,
} from '@/lib/timezone';
import { getScheduledAttendanceTiming, getStoredOrCalculatedAttendanceHours } from '@/lib/work-hours';
import { formatAttendanceClockReason } from '@/lib/attendance-clock-reasons';
import { getStoredOvertimeCalculationSettings } from '@/lib/overtime-settings';
import {
  indexApprovedOvertimeRequests,
  resolveAttendanceOvertimeType,
  resolveApprovedAttendanceOvertime,
} from '@/lib/approved-overtime';
import { getAttendanceRegularTimeExclusions } from '@/lib/attendance-leave-hours';

function toWorkDateKey(value: Date | string) {
  if (value instanceof Date) {
    return toTaiwanDateStr(value);
  }

  return value;
}

function parseDateQueryParam(rawValue: string | null) {
  if (rawValue === null || rawValue === '') {
    return {
      value: null,
      isValid: true,
    };
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawValue);
  const parsedDate = dateOnlyMatch
    ? getTaiwanDayStart(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]), Number(dateOnlyMatch[3]))
    : new Date(rawValue);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    (dateOnlyMatch && toTaiwanDateStr(parsedDate) !== rawValue)
  ) {
    return {
      value: null,
      isValid: false,
    };
  }

  return {
    value: parsedDate,
    isValid: true,
  };
}

function parseYearMonthQueryParam(rawValue: string | null) {
  if (rawValue === null || rawValue === '') {
    return {
      value: null,
      isValid: true,
    };
  }

  const matched = /^(\d{4})-(\d{2})$/.exec(rawValue);
  if (!matched) {
    return {
      value: null,
      isValid: false,
    };
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return {
      value: null,
      isValid: false,
    };
  }

  return {
    value: { year, month },
    isValid: true,
  };
}

function parseYearQueryParam(rawValue: string | null) {
  if (rawValue === null || rawValue === '') {
    return {
      value: null,
      isValid: true,
    };
  }

  if (!/^\d{4}$/.test(rawValue)) {
    return {
      value: null,
      isValid: false,
    };
  }

  const year = Number(rawValue);
  if (!Number.isInteger(year) || year < 1) {
    return {
      value: null,
      isValid: false,
    };
  }

  return {
    value: year,
    isValid: true,
  };
}

function mergeWorkDateRange(
  currentRange: Record<string, unknown> | undefined,
  nextStart?: Date,
  nextEnd?: Date
) {
  const currentStart = currentRange?.gte instanceof Date ? currentRange.gte : undefined;
  const currentEnd = currentRange?.lte instanceof Date ? currentRange.lte : undefined;

  const mergedStart = currentStart && nextStart
    ? new Date(Math.max(currentStart.getTime(), nextStart.getTime()))
    : currentStart || nextStart;
  const mergedEnd = currentEnd && nextEnd
    ? new Date(Math.min(currentEnd.getTime(), nextEnd.getTime()))
    : currentEnd || nextEnd;

  return {
    ...(mergedStart ? { gte: mergedStart } : {}),
    ...(mergedEnd ? { lte: mergedEnd } : {}),
  };
}

function matchesRequestedStatus(displayStatus: string, requestedStatus: string) {
  if (requestedStatus === '正常') {
    return displayStatus === '正常';
  }

  if (requestedStatus === '異常') {
    return displayStatus === '異常';
  }

  if (requestedStatus === '遲到') {
    return displayStatus.includes('遲到');
  }

  if (requestedStatus === '早退') {
    return displayStatus.includes('早退');
  }

  if (requestedStatus === '遲到+早退') {
    return displayStatus === '遲到+早退';
  }

  if (requestedStatus === '缺勤') {
    return displayStatus === '缺勤';
  }

  if (requestedStatus === '無班表出勤') {
    return displayStatus === '無班表出勤';
  }

  return false;
}

function getMaterializedStatusValues(requestedStatus: string) {
  if (requestedStatus === '遲到') return ['遲到', '遲到+早退'];
  if (requestedStatus === '早退') return ['早退', '遲到+早退'];
  return [requestedStatus];
}

function addAndWhere(where: Record<string, unknown>, condition: Record<string, unknown>) {
  const currentAnd = where.AND;
  where.AND = Array.isArray(currentAnd)
    ? [...currentAnd, condition]
    : currentAnd
      ? [currentAnd, condition]
      : [condition];
}

async function persistDisplayStatusUpdates(
  updates: Map<string, number[]>
) {
  const chunkSize = 500;
  for (const [displayStatus, ids] of updates) {
    const uniqueIds = [...new Set(ids)];
    for (let index = 0; index < uniqueIds.length; index += chunkSize) {
      await prisma.attendanceRecord.updateMany({
        where: { id: { in: uniqueIds.slice(index, index + chunkSize) } },
        data: { displayStatus },
      });
    }
  }
}

function matchesRequestedOvertimeHours(hours: number, requestedRange: string | null) {
  if (!requestedRange) {
    return true;
  }

  if (requestedRange === '0') {
    return hours === 0;
  }

  if (requestedRange === '>0') {
    return hours > 0;
  }

  if (requestedRange === '>2') {
    return hours > 2;
  }

  if (requestedRange === '>4') {
    return hours > 4;
  }

  return true;
}

function resolveDisplayAttendanceStatus(params: {
  clockInTime: Date | null;
  clockOutTime: Date | null;
  totalHours: number;
  schedule?: {
    workDate?: string;
    shiftType?: string;
    startTime?: string;
    endTime?: string;
    workHours?: number;
  };
  minimumWorkHoursFallback: number;
}) {
  const { clockInTime, clockOutTime, totalHours, schedule, minimumWorkHoursFallback } = params;
  const hasClockIn = !!clockInTime;
  const hasClockOut = !!clockOutTime;
  const hasSchedule = !!schedule;
  const nonWorkingShiftTypes = new Set(['NH', 'RD', 'rd', 'FDL', 'OFF', 'TD']);
  const requiresWorkHours = hasSchedule && !nonWorkingShiftTypes.has(schedule.shiftType || '');
  const minimumWorkHours = requiresWorkHours ? (schedule.workHours ?? 0) : minimumWorkHoursFallback;

  if (!hasClockIn && !hasClockOut) {
    if (!hasSchedule) return '異常';
    return requiresWorkHours ? '缺勤' : '正常';
  }

  if (!hasClockIn || !hasClockOut) {
    return '異常';
  }

  if (!hasSchedule) {
    return '無班表出勤';
  }

  const { isLate, isEarly } = requiresWorkHours
    ? getScheduledAttendanceTiming({
        clockInTime,
        clockOutTime,
        schedule: {
          workDate: schedule.workDate,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        },
      })
    : { isLate: false, isEarly: false };

  if (isLate && isEarly) return '遲到+早退';
  if (isLate) return '遲到';
  if (isEarly) return '早退';

  if (requiresWorkHours && totalHours + 0.01 < minimumWorkHours * 0.9) {
    return '異常';
  }

  return '正常';
}

const MIN_WORK_HOURS = 8;

// 列表（本頁明細）一筆紀錄
type AttendanceListRecord = Prisma.AttendanceRecordGetPayload<{
  include: {
    employee: {
      select: { id: true; employeeId: true; name: true; department: true; position: true };
    };
  };
}>;

// 摘要只需要這些欄位
type AttendanceSummaryRecord = Pick<
  AttendanceListRecord,
  | 'id'
  | 'employeeId'
  | 'workDate'
  | 'clockInTime'
  | 'clockOutTime'
  | 'regularHours'
  | 'overtimeHours'
  | 'clockInOvertimeId'
  | 'clockOutOvertimeId'
  | 'displayStatus'
>;

const SUMMARY_SOURCE_SELECT = {
  id: true,
  employeeId: true,
  workDate: true,
  clockInTime: true,
  clockOutTime: true,
  regularHours: true,
  overtimeHours: true,
  clockInOvertimeId: true,
  clockOutOvertimeId: true,
  displayStatus: true,
} as const;

type ScheduleSnapshot = {
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime: number;
  workHours: number;
};

/**
 * 載入一批紀錄所需的班表、核准加班與請假（只取這批紀錄涵蓋的員工與日期）。
 * 列表只傳本頁的紀錄，摘要傳全部符合的紀錄，所以翻頁不必重讀整段歷史。
 */
async function loadAttendanceContext(records: Array<{ employeeId: number; workDate: Date }>) {
  const workDates = [...new Set(records.map(r => toTaiwanDateStr(r.workDate)))].sort();
  const employeeIds = [...new Set(records.map(r => r.employeeId))];
  const overtimeSettings = await getStoredOvertimeCalculationSettings();

  const [schedules, approvedOvertimeRequests, attendanceLeaves] = await Promise.all([
    prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: { in: workDates }
      }
    }),
    employeeIds.length === 0 || workDates.length === 0
      ? Promise.resolve([])
      : prisma.overtimeRequest.findMany({
          where: {
            employeeId: { in: employeeIds },
            status: 'APPROVED',
            overtimeDate: {
             gte: getTaiwanDayStart(
               Number(workDates[0].slice(0, 4)),
               Number(workDates[0].slice(5, 7)),
               Number(workDates[0].slice(8, 10))
             ),
             lte: getTaiwanDayEnd(
               Number(workDates[workDates.length - 1].slice(0, 4)),
               Number(workDates[workDates.length - 1].slice(5, 7)),
               Number(workDates[workDates.length - 1].slice(8, 10))
             ),
            }
          },
          select: {
            id: true,
            employeeId: true,
            overtimeDate: true,
            totalHours: true,
            compensationType: true,
          }
        }),
    employeeIds.length === 0 || workDates.length === 0
      ? Promise.resolve([])
      : prisma.leaveRequest.findMany({
          where: {
            employeeId: { in: employeeIds },
            voidedAt: null,
            OR: [
              { status: 'APPROVED' },
              { status: 'PENDING_ADMIN', managerOpinion: 'AGREE' },
            ],
            startDate: {
              lte: getTaiwanDayEnd(
                Number(workDates[workDates.length - 1].slice(0, 4)),
                Number(workDates[workDates.length - 1].slice(5, 7)),
                Number(workDates[workDates.length - 1].slice(8, 10))
              ),
            },
            endDate: {
              gte: getTaiwanDayStart(
                Number(workDates[0].slice(0, 4)),
                Number(workDates[0].slice(5, 7)),
                Number(workDates[0].slice(8, 10))
              ),
            },
          },
          select: {
            employeeId: true,
            startDate: true,
            endDate: true,
            status: true,
            managerOpinion: true,
            voidedAt: true,
          },
        })
  ]);

  const approvedOvertimeIndex = indexApprovedOvertimeRequests(approvedOvertimeRequests);
  const leavesByEmployee = new Map<number, Array<(typeof attendanceLeaves)[number]>>();
  for (const leave of attendanceLeaves) {
    const employeeLeaves = leavesByEmployee.get(leave.employeeId);
    if (employeeLeaves) employeeLeaves.push(leave);
    else leavesByEmployee.set(leave.employeeId, [leave]);
  }
  // 同一位員工的請假區間對每筆紀錄都一樣，算一次就好
  const exclusionsByEmployee = new Map<number, ReturnType<typeof getAttendanceRegularTimeExclusions>>();
  const getRegularTimeExclusions = (employeeId: number) => {
    let exclusions = exclusionsByEmployee.get(employeeId);
    if (!exclusions) {
      exclusions = getAttendanceRegularTimeExclusions(leavesByEmployee.get(employeeId) || []);
      exclusionsByEmployee.set(employeeId, exclusions);
    }
    return exclusions;
  };

  // 建立班表查詢 Map
  const scheduleMap = new Map<string, ScheduleSnapshot>();
  schedules.forEach(s => {
    const key = `${s.employeeId}-${toWorkDateKey(s.workDate)}`;
    scheduleMap.set(key, {
      workDate: toWorkDateKey(s.workDate),
      shiftType: s.shiftType,
      startTime: s.startTime,
      endTime: s.endTime,
      breakTime: s.breakTime,
      workHours: s.workHours,
    });
  });

  return { overtimeSettings, scheduleMap, approvedOvertimeIndex, getRegularTimeExclusions };
}

type AttendanceContext = Awaited<ReturnType<typeof loadAttendanceContext>>;

/** 一筆紀錄只算一次：工時、有效加班、顯示狀態（列表與摘要共用，不再各走訪一遍）。 */
function evaluateAttendanceRecord(record: AttendanceSummaryRecord, context: AttendanceContext) {
  const workDateStr = toTaiwanDateStr(record.workDate);
  const schedule = context.scheduleMap.get(`${record.employeeId}-${workDateStr}`);

  const hours = getStoredOrCalculatedAttendanceHours({
    ...record,
    breakTime: schedule?.breakTime || 0,
    scheduledWorkHours: schedule?.workHours,
    scheduledStart: schedule?.startTime,
    scheduledEnd: schedule?.endTime,
    regularTimeExclusions: context.getRegularTimeExclusions(record.employeeId),
  });
  const validOvertime = resolveApprovedAttendanceOvertime(
    {
      employeeId: record.employeeId,
      workDate: record.workDate,
      regularHours: hours.regularHours,
      actualWorkHours: hours.totalHours,
      overtimeHours: hours.overtimeHours,
      clockInOvertimeId: record.clockInOvertimeId,
      clockOutOvertimeId: record.clockOutOvertimeId,
      overtimeType: resolveAttendanceOvertimeType({
        shiftType: schedule?.shiftType,
        workDate: record.workDate,
      }),
    },
    context.approvedOvertimeIndex,
    context.overtimeSettings.overtimeMinUnit
  );
  const displayStatus = resolveDisplayAttendanceStatus({
    clockInTime: record.clockInTime,
    clockOutTime: record.clockOutTime,
    totalHours: hours.totalHours,
    schedule,
    minimumWorkHoursFallback: MIN_WORK_HOURS,
  });

  return { workDateStr, schedule, hours, validOvertime, displayStatus };
}

function createDisplayStatusQueue() {
  const updates = new Map<string, number[]>();
  const queue = (record: { id: number; displayStatus?: string | null }, displayStatus: string) => {
    if (record.displayStatus === displayStatus) return;
    const ids = updates.get(displayStatus);
    if (ids) ids.push(record.id);
    else updates.set(displayStatus, [record.id]);
  };
  return { updates, queue };
}

/** 同一位員工在同一個台北工作日有多筆紀錄 → 標記為重複打卡。 */
function countDuplicateRecords(records: Array<{ employeeId: number; workDate: Date }>) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = `${record.employeeId}-${toTaiwanDateStr(record.workDate)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * 只取本頁時，重複打卡仍要看「本頁員工在同一台北工作日」的其他紀錄（同樣受查詢範圍限制），
 * 不能只在這 10 筆之內比對。
 */
async function loadSameDayRecords(where: Record<string, unknown>, pageRecords: AttendanceListRecord[]) {
  if (pageRecords.length === 0) return [];

  const days = pageRecords.map(record => toTaiwanDateStr(record.workDate)).sort();
  const [firstYear, firstMonth, firstDay] = days[0].split('-').map(Number);
  const [lastYear, lastMonth, lastDay] = days[days.length - 1].split('-').map(Number);

  return prisma.attendanceRecord.findMany({
    where: {
      AND: [
        where,
        {
          employeeId: { in: [...new Set(pageRecords.map(record => record.employeeId))] },
          workDate: {
            gte: getTaiwanDayStart(firstYear, firstMonth, firstDay),
            lte: getTaiwanDayEnd(lastYear, lastMonth, lastDay),
          },
        },
      ],
    },
    select: { employeeId: true, workDate: true },
  });
}

function formatAttendanceRecord(
  record: AttendanceListRecord,
  context: AttendanceContext,
  duplicateCounts: Map<string, number>,
  isAdmin: boolean,
  queueDisplayStatusUpdate: ReturnType<typeof createDisplayStatusQueue>['queue']
) {
  const { workDateStr, schedule, hours, validOvertime, displayStatus } = evaluateAttendanceRecord(record, context);
  queueDisplayStatusUpdate(record, displayStatus);

  return {
    id: record.id,
    employeeId: record.employeeId,
    workDate: record.workDate.toISOString(),
    clockInTime: record.clockInTime?.toISOString() || null,
    clockOutTime: record.clockOutTime?.toISOString() || null,
    totalHours: hours.totalHours,
    regularHours: validOvertime.regularHours,
    overtimeHours: validOvertime.effectiveHours,
    status: displayStatus,
    duplicated: (duplicateCounts.get(`${record.employeeId}-${workDateStr}`) || 0) > 1,
    createdAt: record.createdAt.toISOString(),
    employee: record.employee,
    clockInHasFever: record.clockInHasFever,
    clockInTemperature: record.clockInTemperature,
    clockInHasAcuteCough: record.clockInHasAcuteCough,
    clockOutHasFever: record.clockOutHasFever,
    clockOutTemperature: record.clockOutTemperature,
    clockOutHasAcuteCough: record.clockOutHasAcuteCough,
    // 新增：班表資訊
    shiftType: schedule?.shiftType || null,
    scheduledStart: schedule?.startTime || null,
    scheduledEnd: schedule?.endTime || null,
    // 新增：GPS 資訊（僅管理員/HR 可查看）
    ...(isAdmin ? {
      clockInReason: formatAttendanceClockReason(record.clockInReason),
      clockOutReason: formatAttendanceClockReason(record.clockOutReason),
      clockInLatitude: record.clockInLatitude,
      clockInLongitude: record.clockInLongitude,
      clockInAccuracy: record.clockInAccuracy,
      clockInAddress: record.clockInAddress,
      clockOutLatitude: record.clockOutLatitude,
      clockOutLongitude: record.clockOutLongitude,
      clockOutAccuracy: record.clockOutAccuracy,
      clockOutAddress: record.clockOutAddress
    } : {})
  };
}

type FormattedAttendanceRecord = ReturnType<typeof formatAttendanceRecord>;

/** 摘要（未格式化的原始紀錄）：一次走訪同時累計正常工時、有效加班與狀態分布。 */
function summarizeAttendanceRecords(
  records: AttendanceSummaryRecord[],
  context: AttendanceContext,
  queueDisplayStatusUpdate: ReturnType<typeof createDisplayStatusQueue>['queue']
) {
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  const statusBreakdown: Record<string, number> = {};

  for (const record of records) {
    const { validOvertime, displayStatus } = evaluateAttendanceRecord(record, context);
    queueDisplayStatusUpdate(record, displayStatus);
    totalRegularHours += validOvertime.regularHours;
    totalOvertimeHours += validOvertime.effectiveHours;
    statusBreakdown[displayStatus] = (statusBreakdown[displayStatus] || 0) + 1;
  }

  return { totalRegularHours, totalOvertimeHours, statusBreakdown };
}

/** 摘要（已格式化、已套用狀態／加班篩選的紀錄）。 */
function summarizeFormattedRecords(records: FormattedAttendanceRecord[]) {
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  const statusBreakdown: Record<string, number> = {};

  for (const record of records) {
    totalRegularHours += record.regularHours;
    totalOvertimeHours += record.overtimeHours;
    statusBreakdown[record.status] = (statusBreakdown[record.status] || 0) + 1;
  }

  return { totalRegularHours, totalOvertimeHours, statusBreakdown };
}

// 獲取考勤記錄
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsedPage = parseIntegerQueryParam(searchParams.get('page'), { defaultValue: 1, min: 1 });
    if (!parsedPage.isValid || parsedPage.value === null) {
      return NextResponse.json({ error: 'page 參數格式無效' }, { status: 400 });
    }

    const parsedPageSize = parseIntegerQueryParam(searchParams.get('pageSize'), { defaultValue: 10, min: 1, max: 100 });
    if (!parsedPageSize.isValid || parsedPageSize.value === null) {
      return NextResponse.json({ error: 'pageSize 參數格式無效' }, { status: 400 });
    }

    const page = parsedPage.value;
    const pageSize = parsedPageSize.value;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const year = searchParams.get('year');
    const yearMonth = searchParams.get('yearMonth');
    const search = searchParams.get('search');
    const employeeFilter = searchParams.get('employeeId');
    const status = searchParams.get('status');
    const overtimeHours = searchParams.get('overtimeHours');
    const department = searchParams.get('department');

    const parsedStartDate = parseDateQueryParam(startDate);
    if (!parsedStartDate.isValid) {
      return NextResponse.json({ error: 'startDate 參數格式無效' }, { status: 400 });
    }

    const parsedEndDate = parseDateQueryParam(endDate);
    if (!parsedEndDate.isValid) {
      return NextResponse.json({ error: 'endDate 參數格式無效' }, { status: 400 });
    }

    const parsedYear = parseYearQueryParam(year);
    if (!parsedYear.isValid) {
      return NextResponse.json({ error: 'year 參數格式無效' }, { status: 400 });
    }

    const parsedYearMonth = parseYearMonthQueryParam(yearMonth);
    if (!parsedYearMonth.isValid) {
      return NextResponse.json({ error: 'yearMonth 參數格式無效' }, { status: 400 });
    }

    const allowedStatuses = new Set(['正常', '異常', '遲到', '早退', '缺勤', '遲到+早退', '無班表出勤']);
    if (status && !allowedStatuses.has(status)) {
      return NextResponse.json({ error: 'status 參數格式無效' }, { status: 400 });
    }

    // view：list＝只回本頁明細（翻頁、匯出用）、summary＝只回全範圍摘要；未指定＝兩者都回（舊行為）
    const view = searchParams.get('view');
    if (view !== null && view !== 'list' && view !== 'summary') {
      return NextResponse.json({ error: 'view 參數格式無效' }, { status: 400 });
    }

    console.log('📋 獲取考勤記錄請求:', { 
      username: user.username, 
      employeeId: user.employeeId,
      page, 
      pageSize, 
      startDate, 
      endDate,
      year,
      search,
      status,
      overtimeHours
    });

    const hasFullAttendanceAccess = user.role === 'ADMIN' || user.role === 'HR';
    const managerRecords = !hasFullAttendanceAccess && user.employeeId
      ? await prisma.departmentManager.findMany({
          where: { employeeId: user.employeeId, isActive: true },
          select: { department: true },
        })
      : [];
    const managedDepartments = [...new Set(
      managerRecords
        .map((record) => record.department?.trim())
        .filter((managedDepartment): managedDepartment is string => Boolean(managedDepartment))
    )];
    const canViewDepartmentRecords = hasFullAttendanceAccess || managedDepartments.length > 0;

    // 構建查詢條件
    const where: Record<string, unknown> = {};

    // 一般員工只能查看本人；部門主管可查看目前有效管理部門，且範圍不可被查詢參數放寬。
    if (!canViewDepartmentRecords) {
      where.employeeId = user.employeeId ?? -1;
    } else {
      const employeeConditions: Record<string, unknown>[] = [];

      if (!hasFullAttendanceAccess) {
        employeeConditions.push({ department: { in: managedDepartments } });
      }
      
      // 搜尋條件
      if (search) {
        employeeConditions.push({
          OR: [
            { name: { contains: search } },
            { employeeId: { contains: search } }
          ]
        });
      }

      if (employeeFilter) {
        employeeConditions.push({ employeeId: employeeFilter });
      }
      
      // 部門篩選
      if (department) {
        employeeConditions.push({ department: department });
      }
      
      // 組合條件
      if (employeeConditions.length > 0) {
        where.employee = employeeConditions.length === 1 
          ? employeeConditions[0] 
          : { AND: employeeConditions };
      }
    }

    // 日期篩選
    if (startDate || endDate) {
      let endDateValue: Date | undefined;
      const endDateOnlyMatch = endDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate) : null;
      if (endDateOnlyMatch) {
        endDateValue = getTaiwanDayEnd(
          Number(endDateOnlyMatch[1]),
          Number(endDateOnlyMatch[2]),
          Number(endDateOnlyMatch[3])
        );
      } else if (parsedEndDate.value) {
        endDateValue = parsedEndDate.value;
      }

      where.workDate = mergeWorkDateRange(
        where.workDate as Record<string, unknown> | undefined,
        parsedStartDate.value ?? undefined,
        endDateValue
      );
    }

    if (parsedYear.value !== null) {
      const yearStart = getTaiwanMonthStart(parsedYear.value, 1);
      const yearEnd = getTaiwanMonthEnd(parsedYear.value, 12);
      where.workDate = mergeWorkDateRange(
        where.workDate as Record<string, unknown> | undefined,
        yearStart,
        yearEnd
      );
    }

    if (parsedYearMonth.value) {
      const monthStart = getTaiwanMonthStart(parsedYearMonth.value.year, parsedYearMonth.value.month);
      const monthEnd = getTaiwanMonthEnd(parsedYearMonth.value.year, parsedYearMonth.value.month);

      where.workDate = mergeWorkDateRange(
        where.workDate as Record<string, unknown> | undefined,
        monthStart,
        monthEnd
      );
    }

    if (status) {
      addAndWhere(where, {
        OR: [
          { displayStatus: { in: getMaterializedStatusValues(status) } },
          { displayStatus: null },
        ],
      });
    }

    const shouldFilterInMemory = !!status || !!overtimeHours;

    const recordQuery = {
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      },
      // 同一天的紀錄要有固定次序（id 作第二排序鍵），翻頁與分批匯出才不會因並列而漏筆或重複
      orderBy: [{ workDate: 'desc' as const }, { id: 'desc' as const }]
    };
    const pageWindow = { skip: (page - 1) * pageSize, take: pageSize };

    // 管理員/HR 可查看 GPS 與打卡原因
    const isAdmin = hasFullAttendanceAccess;
    const { updates: displayStatusUpdates, queue: queueDisplayStatusUpdate } = createDisplayStatusQueue();

    let total = 0;
    let finalRecords: FormattedAttendanceRecord[] = [];
    let summaryTotals: ReturnType<typeof summarizeFormattedRecords> | null = null;

    if (shouldFilterInMemory) {
      // 狀態與加班是逐筆算出來的衍生值，必須全部算完才能篩選與分頁；這條路徑本來就是整批處理，
      // 摘要是順帶的，所以不論 view 為何都一次算完。
      const candidates = await prisma.attendanceRecord.findMany(recordQuery);
      const context = await loadAttendanceContext(candidates);
      const duplicateCounts = countDuplicateRecords(candidates);
      const formattedCandidates = candidates.map(record =>
        formatAttendanceRecord(record, context, duplicateCounts, isAdmin, queueDisplayStatusUpdate)
      );
      const matched = formattedCandidates.filter(record =>
        (!status || matchesRequestedStatus(record.status, status)) &&
        matchesRequestedOvertimeHours(record.overtimeHours, overtimeHours)
      );
      total = matched.length;
      finalRecords = matched.slice((page - 1) * pageSize, page * pageSize);
      summaryTotals = summarizeFormattedRecords(matched);
    } else if (view === 'summary') {
      // 只要摘要：讀全範圍的最少欄位，不格式化任何明細
      total = await prisma.attendanceRecord.count({ where });
      const summarySourceRecords = await prisma.attendanceRecord.findMany({
        where,
        select: SUMMARY_SOURCE_SELECT,
      });
      const context = await loadAttendanceContext(summarySourceRecords);
      summaryTotals = summarizeAttendanceRecords(summarySourceRecords, context, queueDisplayStatusUpdate);
    } else if (view === 'list') {
      // 只要本頁明細：班表、核准加班、請假與重複打卡都只查本頁涉及的員工與日期，成本與歷史資料量無關
      total = await prisma.attendanceRecord.count({ where });
      const pageRecords = await prisma.attendanceRecord.findMany({ ...recordQuery, ...pageWindow });
      const [sameDayRecords, context] = await Promise.all([
        loadSameDayRecords(where, pageRecords),
        loadAttendanceContext(pageRecords),
      ]);
      const duplicateCounts = countDuplicateRecords(sameDayRecords);
      finalRecords = pageRecords.map(record =>
        formatAttendanceRecord(record, context, duplicateCounts, isAdmin, queueDisplayStatusUpdate)
      );
    } else {
      // 預設（舊行為）：本頁明細與全範圍摘要一起回傳
      total = await prisma.attendanceRecord.count({ where });
      const pageRecords = await prisma.attendanceRecord.findMany({ ...recordQuery, ...pageWindow });
      const summarySourceRecords = await prisma.attendanceRecord.findMany({
        where,
        select: SUMMARY_SOURCE_SELECT,
      });
      const context = await loadAttendanceContext([...pageRecords, ...summarySourceRecords]);
      const duplicateCounts = countDuplicateRecords(summarySourceRecords);
      finalRecords = pageRecords.map(record =>
        formatAttendanceRecord(record, context, duplicateCounts, isAdmin, queueDisplayStatusUpdate)
      );
      summaryTotals = summarizeAttendanceRecords(summarySourceRecords, context, queueDisplayStatusUpdate);
    }

    console.log(`✅ 返回考勤記錄: ${finalRecords.length} 筆 (總共 ${total} 筆)`);
    await persistDisplayStatusUpdates(displayStatusUpdates);

    return NextResponse.json({
      success: true,
      ...(view === 'summary' ? {} : {
        records: finalRecords,
        pagination: {
          current: page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        },
      }),
      ...(view === 'list' || !summaryTotals ? {} : {
        summary: {
          totalRecords: total,
          totalRegularHours: Math.round(summaryTotals.totalRegularHours * 100) / 100,
          totalOvertimeHours: Math.round(summaryTotals.totalOvertimeHours * 100) / 100,
          statusBreakdown: summaryTotals.statusBreakdown
        },
      }),
      scope: {
        canViewDepartmentRecords,
        managedDepartments,
      }
    });
  
  } catch (error) {
    console.error('獲取考勤記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
