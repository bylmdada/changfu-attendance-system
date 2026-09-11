import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';
import { listShiftDefinitions } from '@/lib/shift-definition-service';
import { checkMultipleDatesFreeze, checkAttendanceFreeze, getAttendanceFreezeError } from '@/lib/attendance-freeze';

// 天災類型標籤
const DISASTER_TYPES = {
  TYPHOON: '颱風',
  EARTHQUAKE: '地震',
  RAIN: '雨災',
  WIND: '風災',
  OTHER: '其他'
};

// 停班類型標籤
const STOP_WORK_TYPES = {
  FULL: '全日停班',
  AM: '上午停班',
  PM: '下午停班'
};

const VALID_DISASTER_TYPES = Object.keys(DISASTER_TYPES);
const VALID_STOP_WORK_TYPES = Object.keys(STOP_WORK_TYPES);
const VALID_AFFECTED_SCOPES = ['ALL', 'DEPARTMENTS', 'EMPLOYEES'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeEmployeeIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalizedIds: number[] = [];
  for (const item of value) {
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || item <= 0) {
        return null;
      }
      normalizedIds.push(item);
      continue;
    }

    if (typeof item !== 'string') {
      return null;
    }

    const parsedId = parseIntegerQueryParam(item, { min: 1 });
    if (!parsedId.isValid || parsedId.value === null) {
      return null;
    }

    normalizedIds.push(parsedId.value);
  }

  return normalizedIds;
}

interface OriginalScheduleSnapshot {
  employeeId: number;
  existed: boolean;
  shiftType: string | null;
  startTime: string | null;
  endTime: string | null;
  breakTime: number | null;
  workHours: number | null;
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return null;
  }

  return parsedDate;
}

function toDateKey(date: Date) {
  return date.toISOString().split('T')[0];
}

function buildDateRange(startDate: Date, days: number) {
  return Array.from({ length: days }, (_, index) => {
    const currentDate = new Date(startDate);
    currentDate.setUTCDate(currentDate.getUTCDate() + index);
    return toDateKey(currentDate);
  });
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatMinutes(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function getDisasterScheduleFields(
  stopWorkType: string,
  snapshot?: OriginalScheduleSnapshot
): { startTime: string; endTime: string; breakTime: number; workHours: number } {
  if (stopWorkType === 'FULL') {
    return { startTime: '', endTime: '', breakTime: 0, workHours: 0 };
  }

  const originalStartTime = snapshot?.startTime;
  const originalEndTime = snapshot?.endTime;
  const originalWorkHours = snapshot?.workHours;
  const start = originalStartTime ? parseTimeToMinutes(originalStartTime) : null;
  const end = originalEndTime ? parseTimeToMinutes(originalEndTime) : null;
  if (start === null || end === null || originalWorkHours === null || originalWorkHours === undefined || !originalStartTime || !originalEndTime) {
    throw new Error('DISASTER_PARTIAL_NO_SCHEDULE');
  }

  const halfWorkMinutes = Math.round(originalWorkHours * 30);
  const normalizedEnd = end <= start ? end + 1440 : end;
  return {
    startTime: stopWorkType === 'AM' ? formatMinutes(normalizedEnd - halfWorkMinutes) : originalStartTime,
    endTime: stopWorkType === 'AM' ? originalEndTime : formatMinutes(start + halfWorkMinutes),
    breakTime: 0,
    workHours: Math.round((originalWorkHours / 2) * 100) / 100,
  };
}

function parseOriginalSchedules(value: string | null): OriginalScheduleSnapshot[] | null {
  if (!value) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value);
    if (!Array.isArray(parsedValue)) {
      return null;
    }

    const snapshots: OriginalScheduleSnapshot[] = [];
    for (const item of parsedValue) {
      if (!isPlainObject(item)) {
        return null;
      }

      const employeeId = typeof item.employeeId === 'number' ? item.employeeId : Number.NaN;
      const existed = typeof item.existed === 'boolean' ? item.existed : false;
      const shiftType = typeof item.shiftType === 'string' ? item.shiftType : null;
      const startTime = typeof item.startTime === 'string' ? item.startTime : null;
      const endTime = typeof item.endTime === 'string' ? item.endTime : null;
      const breakTime = typeof item.breakTime === 'number' && Number.isFinite(item.breakTime) ? item.breakTime : null;
      const workHours = typeof item.workHours === 'number' && Number.isFinite(item.workHours) ? item.workHours : null;

      if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
        return null;
      }

      if (existed && (shiftType === null || startTime === null || endTime === null)) {
        return null;
      }

      snapshots.push({
        employeeId,
        existed,
        shiftType,
        startTime,
        endTime,
        breakTime,
        workHours,
      });
    }

    return snapshots;
  } catch {
    return null;
  }
}

async function hydrateLegacySnapshots(snapshots: OriginalScheduleSnapshot[]) {
  if (!snapshots.some((snapshot) => snapshot.existed && (snapshot.breakTime === null || snapshot.workHours === null))) {
    return snapshots;
  }

  const definitions = await listShiftDefinitions({ includeInactive: true });
  const definitionByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  return snapshots.map((snapshot) => {
    const definition = snapshot.shiftType ? definitionByCode.get(snapshot.shiftType) : undefined;
    return {
      ...snapshot,
      breakTime: snapshot.breakTime ?? definition?.breakTime ?? null,
      workHours: snapshot.workHours ?? definition?.workHours ?? null,
    };
  });
}

// GET - 取得天災假記錄列表
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員和HR可以查看
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const parsedYear = parseIntegerQueryParam(yearParam, { min: 2000, max: 2100 });
    const parsedMonth = parseIntegerQueryParam(monthParam, { min: 1, max: 12 });

    if (!parsedYear.isValid) {
      return NextResponse.json({ error: 'year 格式錯誤' }, { status: 400 });
    }

    if (!parsedMonth.isValid) {
      return NextResponse.json({ error: 'month 格式錯誤' }, { status: 400 });
    }

    // 建立查詢條件
    const where: Record<string, unknown> = {};
    
    if (parsedYear.value !== null && parsedMonth.value !== null) {
      const year = String(parsedYear.value);
      const month = String(parsedMonth.value).padStart(2, '0');
      const startDate = `${year}-${month.padStart(2, '0')}-01`;
      const endDate = `${year}-${month.padStart(2, '0')}-31`;
      where.disasterDate = {
        gte: startDate,
        lte: endDate
      };
    } else if (parsedYear.value !== null) {
      const year = String(parsedYear.value);
      where.disasterDate = {
        gte: `${year}-01-01`,
        lte: `${year}-12-31`
      };
    }

    const records = await prisma.disasterDayOff.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            department: true
          }
        }
      },
      orderBy: { disasterDate: 'desc' }
    });

    return NextResponse.json({
      records,
      labels: {
        disasterTypes: DISASTER_TYPES,
        stopWorkTypes: STOP_WORK_TYPES
      }
    });

  } catch (error) {
    console.error('取得天災假記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 批量設定天災假
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/disaster-day-off');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員和HR可以設定
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的天災假資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;
    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的天災假資料' }, { status: 400 });
    }

    const disasterDate = typeof data.disasterDate === 'string' ? data.disasterDate.trim() : '';
    const numberOfDays = data.numberOfDays;
    const disasterType = typeof data.disasterType === 'string' ? data.disasterType : '';
    const stopWorkType = typeof data.stopWorkType === 'string' ? data.stopWorkType : '';
    const affectedScope = typeof data.affectedScope === 'string' ? data.affectedScope : 'ALL';
    const description = typeof data.description === 'string' ? data.description : undefined;

    if (!VALID_AFFECTED_SCOPES.includes(affectedScope)) {
      return NextResponse.json({ error: '無效的影響範圍' }, { status: 400 });
    }

    const affectedDepartments = affectedScope === 'DEPARTMENTS'
      ? (isStringArray(data.affectedDepartments) ? data.affectedDepartments : null)
      : [];
    const affectedEmployeeIds = affectedScope === 'EMPLOYEES'
      ? normalizeEmployeeIds(data.affectedEmployeeIds)
      : [];

    if (affectedScope === 'DEPARTMENTS' && affectedDepartments === null) {
      return NextResponse.json({ error: 'affectedDepartments 格式錯誤' }, { status: 400 });
    }

    if (affectedScope === 'EMPLOYEES' && affectedEmployeeIds === null) {
      return NextResponse.json({ error: 'affectedEmployeeIds 格式錯誤' }, { status: 400 });
    }

    const normalizedAffectedDepartments = affectedDepartments ?? [];
    const normalizedAffectedEmployeeIds = affectedEmployeeIds ?? [];

    // 驗證必填欄位
    if (!disasterDate || !disasterType || !stopWorkType) {
      return NextResponse.json({ error: '請填寫完整資訊' }, { status: 400 });
    }

    const parsedStartDate = parseDateOnly(disasterDate);
    if (!parsedStartDate) {
      return NextResponse.json({ error: '日期格式不正確' }, { status: 400 });
    }

    // 驗證天數
    const parsedDays = typeof numberOfDays === 'number'
      ? (Number.isSafeInteger(numberOfDays) ? numberOfDays : null)
      : typeof numberOfDays === 'string'
        ? parseIntegerQueryParam(numberOfDays, { min: 1, max: 7 }).value
        : 1;
    const days = Math.min(Math.max(1, parsedDays ?? 1), 7);

    // 驗證天災類型
    if (!VALID_DISASTER_TYPES.includes(disasterType)) {
      return NextResponse.json({ error: '無效的天災類型' }, { status: 400 });
    }

    // 驗證停班類型
    if (!VALID_STOP_WORK_TYPES.includes(stopWorkType)) {
      return NextResponse.json({ error: '無效的停班類型' }, { status: 400 });
    }

    const dates = buildDateRange(parsedStartDate, days);

    const freezeError = getAttendanceFreezeError(
      await checkMultipleDatesFreeze(dates.map((date) => new Date(`${date}T00:00:00+08:00`)))
    );
    if (freezeError) {
      return NextResponse.json({ error: freezeError }, { status: 409 });
    }

    const existingRecords = await prisma.disasterDayOff.findMany({
      where: {
        disasterDate: { in: dates }
      },
      select: {
        disasterDate: true
      }
    });

    const existingDates = existingRecords.map((record) => record.disasterDate);

    if (existingDates.length > 0) {
      return NextResponse.json({ 
        error: `以下日期已設定天災假：${existingDates.join(', ')}` 
      }, { status: 400 });
    }

    // 取得受影響的員工
    let affectedEmployees: { id: number }[] = [];
    
    if (affectedScope === 'ALL') {
      affectedEmployees = await prisma.employee.findMany({
        where: { isActive: true },
        select: { id: true }
      });
    } else if (affectedScope === 'DEPARTMENTS' && normalizedAffectedDepartments.length > 0) {
      affectedEmployees = await prisma.employee.findMany({
        where: { 
          isActive: true,
          department: { in: normalizedAffectedDepartments }
        },
        select: { id: true }
      });
    } else if (affectedScope === 'EMPLOYEES' && normalizedAffectedEmployeeIds.length > 0) {
      affectedEmployees = await prisma.employee.findMany({
        where: { 
          isActive: true,
          id: { in: normalizedAffectedEmployeeIds }
        },
        select: { id: true }
      });
    }

    if (affectedEmployees.length === 0) {
      return NextResponse.json({ error: '未選擇任何受影響的員工' }, { status: 400 });
    }

    const { records: createdRecords, totalCreated, totalUpdated } = await prisma.$transaction(async (tx) => {
      const records = [];
      let createdCount = 0;
      let updatedCount = 0;
      for (const date of dates) {
        const originalSchedulesData: (OriginalScheduleSnapshot & { scheduleId?: number })[] = [];

        for (const emp of affectedEmployees) {
          const existingSchedule = await tx.schedule.findUnique({
            where: {
              employeeId_workDate: {
                employeeId: emp.id,
                workDate: date
              }
            }
          });

          if (existingSchedule) {
            originalSchedulesData.push({
              employeeId: emp.id,
              existed: true,
              shiftType: existingSchedule.shiftType,
              startTime: existingSchedule.startTime,
              endTime: existingSchedule.endTime,
              breakTime: existingSchedule.breakTime,
              workHours: existingSchedule.workHours,
              scheduleId: existingSchedule.id
            });
            continue;
          }

          originalSchedulesData.push({
            employeeId: emp.id,
            existed: false,
            shiftType: null,
            startTime: null,
            endTime: null,
            breakTime: null,
            workHours: null,
          });
        }

        const record = await tx.disasterDayOff.create({
          data: {
            disasterDate: date,
            disasterType,
            stopWorkType,
            affectedScope,
            affectedDepartments: affectedScope === 'DEPARTMENTS' ? JSON.stringify(normalizedAffectedDepartments) : null,
            affectedEmployeeIds: affectedScope === 'EMPLOYEES' ? JSON.stringify(normalizedAffectedEmployeeIds) : null,
            description: description ? `${description}${days > 1 ? ` (${date})` : ''}` : undefined,
            affectedCount: affectedEmployees.length,
            originalSchedules: JSON.stringify(originalSchedulesData.map((snapshot) => ({
              employeeId: snapshot.employeeId,
              existed: snapshot.existed,
              shiftType: snapshot.shiftType,
              startTime: snapshot.startTime,
              endTime: snapshot.endTime,
              breakTime: snapshot.breakTime,
              workHours: snapshot.workHours,
            }))),
            createdBy: user.employeeId
          },
          include: {
            creator: {
              select: {
                id: true,
                name: true,
                department: true
              }
            }
          }
        });
        records.push(record);

        for (const scheduleSnapshot of originalSchedulesData) {
          if (scheduleSnapshot.existed && scheduleSnapshot.scheduleId) {
            const disasterScheduleFields = getDisasterScheduleFields(stopWorkType, scheduleSnapshot);
            await tx.schedule.update({
              where: { id: scheduleSnapshot.scheduleId },
              data: {
                shiftType: 'TD',
                ...disasterScheduleFields
              }
            });
            updatedCount++;
          } else {
            const disasterScheduleFields = getDisasterScheduleFields(stopWorkType);
            await tx.schedule.create({
              data: {
                employeeId: scheduleSnapshot.employeeId,
                workDate: date,
                shiftType: 'TD',
                ...disasterScheduleFields
              }
            });
            createdCount++;
          }
        }
      }

      return {
        records,
        totalCreated: createdCount,
        totalUpdated: updatedCount
      };
    });

    await Promise.all(Array.from(new Set(
      dates.flatMap((date) => affectedEmployees.map((employee) => `${employee.id}:${date.slice(0, 7)}`))
    )).map((key) => {
      const [employeeId, yearMonth] = key.split(':');
      return invalidateConfirmation(Number(employeeId), yearMonth);
    }));

    const dateRange = days > 1 
      ? `${dates[0]} 至 ${dates[dates.length - 1]}（共 ${days} 天）` 
      : disasterDate;

    return NextResponse.json({
      success: true,
      records: createdRecords,
      message: `已設定 ${dateRange} 天災假。影響 ${affectedEmployees.length} 位員工 × ${days} 天（更新: ${totalUpdated}, 新增: ${totalCreated}）`
    });

  } catch (error) {
    if (error instanceof Error && error.message === 'DISASTER_PARTIAL_NO_SCHEDULE') {
      return NextResponse.json({ error: '半日停班需要先有原始班表，請先完成排班後再設定' }, { status: 400 });
    }
    console.error('設定天災假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT - 編輯天災假記錄
export async function PUT(request: NextRequest) {
  try {
    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員和HR可以編輯
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的天災假資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;
    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的天災假資料' }, { status: 400 });
    }

    const parsedId = parseIntegerQueryParam(
      typeof data.id === 'number' ? String(data.id) : typeof data.id === 'string' ? data.id : null,
      { min: 1 }
    );

    if (!parsedId.isValid || parsedId.value === null) {
      return NextResponse.json({ error: '記錄ID 格式錯誤' }, { status: 400 });
    }
    const recordId = parsedId.value;

    const disasterType = typeof data.disasterType === 'string' ? data.disasterType : undefined;
    const stopWorkType = typeof data.stopWorkType === 'string' ? data.stopWorkType : undefined;
    const description = typeof data.description === 'string'
      ? data.description
      : data.description === null
        ? null
        : undefined;

    if (disasterType !== undefined && !VALID_DISASTER_TYPES.includes(disasterType)) {
      return NextResponse.json({ error: '無效的天災類型' }, { status: 400 });
    }

    if (stopWorkType !== undefined && !VALID_STOP_WORK_TYPES.includes(stopWorkType)) {
      return NextResponse.json({ error: '無效的停班類型' }, { status: 400 });
    }

    const record = await prisma.disasterDayOff.findUnique({
      where: { id: recordId }
    });

    if (!record) {
      return NextResponse.json({ error: '找不到記錄' }, { status: 404 });
    }

    const freezeError = getAttendanceFreezeError(
      await checkAttendanceFreeze(new Date(`${record.disasterDate}T00:00:00+08:00`))
    );
    if (freezeError) {
      return NextResponse.json({ error: freezeError }, { status: 409 });
    }

    const updatedStopWorkType = stopWorkType || record.stopWorkType;
    const parsedOriginalSchedules = parseOriginalSchedules(record.originalSchedules);
    if (parsedOriginalSchedules === null) {
      return NextResponse.json({ error: '原始班表資料格式錯誤，無法編輯' }, { status: 500 });
    }
    const originalSchedules = await hydrateLegacySnapshots(parsedOriginalSchedules);

    const updatedRecord = await prisma.$transaction(async (tx) => {
      const normalizedSnapshots: OriginalScheduleSnapshot[] = [];
      if (stopWorkType !== undefined && stopWorkType !== record.stopWorkType) {
        for (const snapshot of originalSchedules) {
          const schedule = await tx.schedule.findUnique({
            where: {
              employeeId_workDate: {
                employeeId: snapshot.employeeId,
                workDate: record.disasterDate
              }
            }
          });

          if (schedule && schedule.shiftType === 'TD') {
            const normalizedSnapshot = {
              ...snapshot,
              breakTime: snapshot.breakTime ?? schedule.breakTime,
              workHours: snapshot.workHours ?? schedule.workHours,
            };
            normalizedSnapshots.push(normalizedSnapshot);
            await tx.schedule.update({
              where: { id: schedule.id },
              data: getDisasterScheduleFields(updatedStopWorkType, normalizedSnapshot)
            });
          } else {
            normalizedSnapshots.push(snapshot);
          }
        }
      }

      return tx.disasterDayOff.update({
        where: { id: recordId },
        data: {
          disasterType: disasterType || record.disasterType,
          stopWorkType: updatedStopWorkType,
          description: description !== undefined ? description : record.description,
          ...(normalizedSnapshots.length > 0 && { originalSchedules: JSON.stringify(normalizedSnapshots) }),
        },
        include: {
          creator: {
            select: { id: true, name: true, department: true }
          }
        }
      });
    });

    if (stopWorkType !== undefined && stopWorkType !== record.stopWorkType) {
      await Promise.all(originalSchedules.map((snapshot) => (
        invalidateConfirmation(snapshot.employeeId, record.disasterDate.slice(0, 7))
      )));
    }

    return NextResponse.json({
      success: true,
      record: updatedRecord,
      message: `已更新 ${record.disasterDate} 的天災假記錄`
    });

  } catch (error) {
    console.error('編輯天災假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE - 刪除天災假記錄
export async function DELETE(request: NextRequest) {
  try {
    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員可以刪除
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const parsedId = parseIntegerQueryParam(id, { min: 1 });

    if (!id) {
      return NextResponse.json({ error: '缺少記錄ID' }, { status: 400 });
    }

    if (!parsedId.isValid || parsedId.value === null) {
      return NextResponse.json({ error: '記錄ID 格式錯誤' }, { status: 400 });
    }
    const recordId = parsedId.value;

    const record = await prisma.disasterDayOff.findUnique({
      where: { id: recordId }
    });

    if (!record) {
      return NextResponse.json({ error: '找不到記錄' }, { status: 404 });
    }

    const freezeError = getAttendanceFreezeError(
      await checkAttendanceFreeze(new Date(`${record.disasterDate}T00:00:00+08:00`))
    );
    if (freezeError) {
      return NextResponse.json({ error: freezeError }, { status: 409 });
    }

    const parsedOriginalSchedules = parseOriginalSchedules(record.originalSchedules);
    if (parsedOriginalSchedules === null) {
      return NextResponse.json({ error: '原始班表資料格式錯誤，無法刪除' }, { status: 500 });
    }
    const originalSchedules = await hydrateLegacySnapshots(parsedOriginalSchedules);

    const restoredCount = await prisma.$transaction(async (tx) => {
      let restored = 0;
      let conflictedSchedules = 0;

      for (const snapshot of originalSchedules) {
        const schedule = await tx.schedule.findUnique({
          where: {
            employeeId_workDate: {
              employeeId: snapshot.employeeId,
              workDate: record.disasterDate
            }
          }
        });

        if (!schedule || schedule.shiftType !== 'TD') {
          if (schedule && schedule.shiftType !== 'TD') {
            conflictedSchedules++;
          }
          continue;
        }

        if (snapshot.existed && snapshot.shiftType && snapshot.startTime && snapshot.endTime) {
          await tx.schedule.update({
            where: { id: schedule.id },
            data: {
              shiftType: snapshot.shiftType,
              startTime: snapshot.startTime,
              endTime: snapshot.endTime,
              breakTime: snapshot.breakTime ?? schedule.breakTime,
              workHours: snapshot.workHours ?? schedule.workHours,
            }
          });
        } else {
          await tx.schedule.delete({
            where: { id: schedule.id }
          });
        }

        restored++;
      }

      if (conflictedSchedules > 0) {
        throw new Error(`DISASTER_DELETE_CONFLICT:${conflictedSchedules}`);
      }

      await tx.disasterDayOff.delete({
        where: { id: recordId }
      });

      return restored;
    });

    await Promise.all(originalSchedules.map((snapshot) => (
      invalidateConfirmation(snapshot.employeeId, record.disasterDate.slice(0, 7))
    )));

    return NextResponse.json({
      success: true,
      message: `已刪除 ${record.disasterDate} 的天災假記錄。${restoredCount > 0 ? `已恢復 ${restoredCount} 位員工的原始班表。` : ''}`
    });

   } catch (error) {
    if (error instanceof Error && error.message.startsWith('DISASTER_DELETE_CONFLICT:')) {
      const conflictedCount = Number(error.message.split(':')[1] || '0');
      return NextResponse.json(
        { error: `有 ${conflictedCount} 筆班表已被改為非 TD，請先確認班表後再刪除天災假記錄` },
        { status: 409 }
      );
    }

    console.error('刪除天災假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
