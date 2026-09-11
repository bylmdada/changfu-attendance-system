import { NextRequest, NextResponse } from 'next/server';
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

function getTaiwanDuplicateKey(record: { employeeId: number; workDate: Date }) {
  return `${record.employeeId}-${toTaiwanDateStr(record.workDate)}`;
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
      orderBy: { workDate: 'desc' as const }
    };

    let total = 0;
    let records;

    if (shouldFilterInMemory) {
      records = await prisma.attendanceRecord.findMany(recordQuery);
    } else {
      total = await prisma.attendanceRecord.count({ where });
      records = await prisma.attendanceRecord.findMany({
        ...recordQuery,
        skip: (page - 1) * pageSize,
        take: pageSize
      });
    }

    const summarySourceRecords = shouldFilterInMemory
      ? records
      : await prisma.attendanceRecord.findMany({
          where,
          select: {
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
          }
        });

    const allRelevantRecords = shouldFilterInMemory ? records : [...records, ...summarySourceRecords];
    const workDates = [...new Set(allRelevantRecords.map(r => toTaiwanDateStr(r.workDate)))].sort();
    const employeeIds = [...new Set(allRelevantRecords.map(r => r.employeeId))];
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
    const attendanceLeavesByEmployee = new Map<number, typeof attendanceLeaves>();
    for (const leave of attendanceLeaves) {
      attendanceLeavesByEmployee.set(leave.employeeId, [
        ...(attendanceLeavesByEmployee.get(leave.employeeId) || []),
        leave,
      ]);
    }
    const getRegularTimeExclusions = (employeeId: number) => (
      getAttendanceRegularTimeExclusions(attendanceLeavesByEmployee.get(employeeId) || [])
    );

    // 建立班表查詢 Map
    const scheduleMap = new Map<string, { workDate: string; shiftType: string; startTime: string; endTime: string; breakTime: number; workHours: number }>();
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

    const MIN_WORK_HOURS = 8;
    const duplicateCounts = new Map<string, number>();
    const duplicateSourceRecords = shouldFilterInMemory ? records : summarySourceRecords;
    for (const record of duplicateSourceRecords) {
      const key = getTaiwanDuplicateKey(record);
      duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
    }
    const displayStatusUpdates = new Map<string, number[]>();
    const queueDisplayStatusUpdate = (
      record: { id: number; displayStatus?: string | null },
      displayStatus: string
    ) => {
      if (record.displayStatus === displayStatus) return;
      displayStatusUpdates.set(displayStatus, [
        ...(displayStatusUpdates.get(displayStatus) || []),
        record.id,
      ]);
    };

    // 格式化記錄
    const formattedRecords = records.map(record => {
      const workDateStr = toTaiwanDateStr(record.workDate);
      const scheduleKey = `${record.employeeId}-${workDateStr}`;
      const schedule = scheduleMap.get(scheduleKey);
      
      const hours = getStoredOrCalculatedAttendanceHours({
        ...record,
        breakTime: schedule?.breakTime || 0,
        scheduledWorkHours: schedule?.workHours,
        scheduledStart: schedule?.startTime,
        scheduledEnd: schedule?.endTime,
        regularTimeExclusions: getRegularTimeExclusions(record.employeeId),
      });
      const totalHours = hours.totalHours;
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
        approvedOvertimeIndex,
        overtimeSettings.overtimeMinUnit
      );
      const displayStatus = resolveDisplayAttendanceStatus({
        clockInTime: record.clockInTime,
        clockOutTime: record.clockOutTime,
        totalHours,
        schedule,
        minimumWorkHoursFallback: MIN_WORK_HOURS,
      });
      queueDisplayStatusUpdate(record, displayStatus);
      
      // 判斷是否為管理員/HR（可查看GPS資訊）
      const isAdmin = user.role === 'ADMIN' || user.role === 'HR';
      
      return {
        id: record.id,
        employeeId: record.employeeId,
        workDate: record.workDate.toISOString(),
        clockInTime: record.clockInTime?.toISOString() || null,
        clockOutTime: record.clockOutTime?.toISOString() || null,
        totalHours,
        regularHours: validOvertime.regularHours,
        overtimeHours: validOvertime.effectiveHours,
        status: displayStatus,
        duplicated: (duplicateCounts.get(getTaiwanDuplicateKey(record)) || 0) > 1,
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
    });

    let finalRecords = formattedRecords;
    if (shouldFilterInMemory) {
      finalRecords = formattedRecords.filter(record =>
        (!status || matchesRequestedStatus(record.status, status)) &&
        matchesRequestedOvertimeHours(record.overtimeHours, overtimeHours)
      );
      total = finalRecords.length;
      finalRecords = finalRecords.slice((page - 1) * pageSize, page * pageSize);
    }

    const summarySource = shouldFilterInMemory
      ? formattedRecords.filter(record =>
          (!status || matchesRequestedStatus(record.status, status)) &&
          matchesRequestedOvertimeHours(record.overtimeHours, overtimeHours)
        )
      : summarySourceRecords;

    const totalRegularHours = summarySource.reduce((sum, record) => {
      if ('status' in record) {
        return sum + record.regularHours;
      }

      const workDateStr = toTaiwanDateStr(record.workDate);
      const schedule = scheduleMap.get(`${record.employeeId}-${workDateStr}`);
      const hours = getStoredOrCalculatedAttendanceHours({
        ...record,
        breakTime: schedule?.breakTime || 0,
        scheduledWorkHours: schedule?.workHours,
        scheduledStart: schedule?.startTime,
        scheduledEnd: schedule?.endTime,
        regularTimeExclusions: getRegularTimeExclusions(record.employeeId),
      });
      return sum + resolveApprovedAttendanceOvertime(
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
        approvedOvertimeIndex,
        overtimeSettings.overtimeMinUnit
      ).regularHours;
    }, 0);
    const totalOvertimeHours = summarySource.reduce((sum, record) => {
      if ('status' in record) {
        return sum + record.overtimeHours;
      }

      const workDateStr = toTaiwanDateStr(record.workDate);
      const schedule = scheduleMap.get(`${record.employeeId}-${workDateStr}`);
      const hours = getStoredOrCalculatedAttendanceHours({
        ...record,
        breakTime: schedule?.breakTime || 0,
        scheduledWorkHours: schedule?.workHours,
        scheduledStart: schedule?.startTime,
        scheduledEnd: schedule?.endTime,
        regularTimeExclusions: getRegularTimeExclusions(record.employeeId),
      });
      const overtimeSummary = resolveApprovedAttendanceOvertime(
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
        approvedOvertimeIndex,
        overtimeSettings.overtimeMinUnit
      );
      return sum + overtimeSummary.effectiveHours;
    }, 0);
    const statusBreakdown = summarySource.reduce((counts, record) => {
      const displayStatus = 'status' in record
        ? record.status
        : resolveDisplayAttendanceStatus({
            clockInTime: record.clockInTime,
            clockOutTime: record.clockOutTime,
            totalHours: getStoredOrCalculatedAttendanceHours({
              ...record,
              breakTime: scheduleMap.get(`${record.employeeId}-${toTaiwanDateStr(record.workDate)}`)?.breakTime || 0,
              scheduledWorkHours: scheduleMap.get(`${record.employeeId}-${toTaiwanDateStr(record.workDate)}`)?.workHours,
              scheduledStart: scheduleMap.get(`${record.employeeId}-${toTaiwanDateStr(record.workDate)}`)?.startTime,
              scheduledEnd: scheduleMap.get(`${record.employeeId}-${toTaiwanDateStr(record.workDate)}`)?.endTime,
            }).totalHours,
            schedule: scheduleMap.get(`${record.employeeId}-${toTaiwanDateStr(record.workDate)}`),
            minimumWorkHoursFallback: MIN_WORK_HOURS,
          });
      if (!('status' in record)) {
        queueDisplayStatusUpdate(record, displayStatus);
      }

      counts[displayStatus] = (counts[displayStatus] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    console.log(`✅ 返回考勤記錄: ${finalRecords.length} 筆 (總共 ${total} 筆)`);
    await persistDisplayStatusUpdates(displayStatusUpdates);

    return NextResponse.json({
      success: true,
      records: finalRecords,
      pagination: {
        current: page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      },
      summary: {
        totalRecords: total,
        totalRegularHours: Math.round(totalRegularHours * 100) / 100,
        totalOvertimeHours: Math.round(totalOvertimeHours * 100) / 100,
        statusBreakdown
      },
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
