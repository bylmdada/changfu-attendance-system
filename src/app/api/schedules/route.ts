import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';
import {
  canManageScheduleEmployee,
  getManageableDepartments,
  hasFullScheduleManagementAccess
} from '@/lib/schedule-management-permissions';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { buildScheduleFieldsFromShiftDefinition, findActiveShiftDefinition } from '@/lib/shift-definition-service';
import { isScheduleHourConsistent } from '@/lib/shift-definition-utils';
import { checkAttendanceFreeze, checkMultipleDatesFreeze, getAttendanceFreezeError } from '@/lib/attendance-freeze';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHour(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

function normalizeWorkDates(value: unknown) {
  if (value === undefined) {
    return {
      provided: false,
      isValid: true,
      dates: [] as string[],
    };
  }

  if (!Array.isArray(value) || value.length === 0) {
    return {
      provided: true,
      isValid: false,
      dates: [] as string[],
    };
  }

  const normalizedDates = value.map((item) => (typeof item === 'string' ? item.trim() : ''));
  const isValid = normalizedDates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));

  return {
    provided: true,
    isValid,
    dates: Array.from(new Set(normalizedDates)),
  };
}

interface ScheduleEntryInput {
  workDate: string;
  shiftType: string;
}

function normalizeScheduleEntries(value: unknown) {
  if (value === undefined) {
    return {
      provided: false,
      isValid: true,
      entries: [] as ScheduleEntryInput[],
      error: null as string | null,
    };
  }

  if (!Array.isArray(value) || value.length === 0) {
    return {
      provided: true,
      isValid: false,
      entries: [] as ScheduleEntryInput[],
      error: 'entries 格式錯誤',
    };
  }

  const seenDates = new Set<string>();
  const entries: ScheduleEntryInput[] = [];

  for (const item of value) {
    if (!isPlainObject(item)) {
      return {
        provided: true,
        isValid: false,
        entries: [] as ScheduleEntryInput[],
        error: 'entries 格式錯誤',
      };
    }

    const workDate = typeof item.workDate === 'string'
      ? item.workDate.trim()
      : typeof item.date === 'string'
        ? item.date.trim()
        : '';
    const shiftType = typeof item.shiftType === 'string' ? item.shiftType.trim() : '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !shiftType) {
      return {
        provided: true,
        isValid: false,
        entries: [] as ScheduleEntryInput[],
        error: 'entries 格式錯誤',
      };
    }

    if (seenDates.has(workDate)) {
      return {
        provided: true,
        isValid: false,
        entries: [] as ScheduleEntryInput[],
        error: 'entries 中的日期不可重複',
      };
    }

    seenDates.add(workDate);
    entries.push({ workDate, shiftType });
  }

  return {
    provided: true,
    isValid: true,
    entries,
    error: null as string | null,
  };
}

function normalizeEmployeeIdentifiers(value: unknown) {
  if (value === undefined) {
    return {
      provided: false,
      isValid: true,
      employeeIds: [] as string[],
    };
  }

  if (!Array.isArray(value) || value.length === 0) {
    return {
      provided: true,
      isValid: false,
      employeeIds: [] as string[],
    };
  }

  const normalizedEmployeeIds = value.map((item) => (
    typeof item === 'string' || typeof item === 'number'
      ? String(item).trim()
      : ''
  ));

  return {
    provided: true,
    isValid: normalizedEmployeeIds.every((employeeId) => employeeId.length > 0),
    employeeIds: Array.from(new Set(normalizedEmployeeIds)),
  };
}

function getYearMonthsFromDates(dates: string[]) {
  return Array.from(new Set(dates.map((date) => date.slice(0, 7))));
}

function toAttendanceDate(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

function buildSyncedShiftFields(shiftCode: string, shiftFieldMap: Map<string, ReturnType<typeof buildScheduleFieldsFromShiftDefinition>>) {
  const fields = shiftFieldMap.get(shiftCode);
  if (!fields) {
    throw new Error(`找不到班別同步資料：${shiftCode}`);
  }

  return fields;
}

function buildSchedulePermissionDeniedMessage(
  employee: { name: string; employeeId: string; department: string | null },
  manageableDepartments: string[]
) {
  const targetDepartment = employee.department || '未設定部門';
  const manageableDepartmentLabel = manageableDepartments.length > 0
    ? manageableDepartments.join('、')
    : '無';

  return `無權限管理員工 ${employee.name}（${employee.employeeId}，部門：${targetDepartment}）的排程；目前可管理部門：${manageableDepartmentLabel}`;
}

// GET: 取得排程列表
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Authentication check
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const department = searchParams.get('department');
    const employeeId = searchParams.get('employeeId');

    // 構建查詢條件
    const where: Record<string, unknown> = {};

    // 日期篩選
    if (date) {
      where.workDate = date;
    } else if (year && month) {
      const yearResult = parseIntegerQueryParam(year, { min: 1900, max: 9999 });
      const monthResult = parseIntegerQueryParam(month, { min: 1, max: 12 });
      if (!yearResult.isValid || yearResult.value === null || !monthResult.isValid || monthResult.value === null) {
        return NextResponse.json({ success: false, error: 'year/month 格式錯誤' }, { status: 400 });
      }
      const monthNumber = monthResult.value;
      const paddedMonth = String(monthNumber).padStart(2, '0');
      const lastDay = new Date(yearResult.value, monthNumber, 0).getDate();
      where.workDate = {
        gte: `${yearResult.value}-${paddedMonth}-01`,
        lte: `${yearResult.value}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`
      };
    } else if (startDate || endDate) {
      where.workDate = {};
      if (startDate) {
        (where.workDate as Record<string, string>).gte = startDate;
      }
      if (endDate) {
        (where.workDate as Record<string, string>).lte = endDate;
      }
    }

    const employeeWhere: Record<string, unknown> = {};

    // 部門篩選
    if (department) {
      employeeWhere.department = department;
    }

    // 員工篩選
    if (employeeId) {
      const employeeIdResult = parseIntegerQueryParam(employeeId, { min: 1, max: 99999999 });
      if (!employeeIdResult.isValid || employeeIdResult.value === null) {
        return NextResponse.json({ success: false, error: 'employeeId 格式錯誤' }, { status: 400 });
      }
      where.employeeId = employeeIdResult.value;
    }

    // 權限檢查：部門主管或授權員工可查看可管理的部門
    const isFullAdmin = hasFullScheduleManagementAccess(user);
    const manageableDepartments = await getManageableDepartments(user);
    
    // 非管理員且無管理權限，只能查看自己的班表
    if (!isFullAdmin && manageableDepartments.length === 0) {
      where.employeeId = user.employeeId;
    } else if (!isFullAdmin && manageableDepartments.length > 0) {
      // 有管理權限，可查看可管理部門的員工
      employeeWhere.department = { in: manageableDepartments };
    }

    if (Object.keys(employeeWhere).length > 0) {
      where.employee = { is: employeeWhere };
    }

    // 查詢班表
    const schedules = await prisma.schedule.findMany({
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
      orderBy: [
        { workDate: 'asc' },
        { startTime: 'asc' }
      ]
    });

    // 格式化輸出
    const formattedSchedules = schedules.map(s => ({
      id: s.id,
      employeeId: s.employeeId,
      employeeCode: s.employee.employeeId,
      employeeName: s.employee.name,
      department: s.employee.department,
      workDate: s.workDate,
      date: s.workDate,
      startTime: s.startTime,
      endTime: s.endTime,
      breakTime: s.breakTime,
      workHours: s.workHours,
      specialLeaveHours: s.specialLeaveHours,
      compLeaveHours: s.compLeaveHours,
      overtimeHours: s.overtimeHours,
      shiftType: s.shiftType,
      status: 'active',
      employee: s.employee
    }));

    return NextResponse.json({
      success: true,
      schedules: formattedSchedules,
      total: formattedSchedules.length
    });
  } catch (error) {
    console.error('取得排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// POST: 新增排程
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    // 權限檢查：部門主管或授權員工可新增可管理部門的排程
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error === 'empty_body' ? '請提供有效的排程資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { success: false, error: '請提供有效的排程資料' },
        { status: 400 }
      );
    }

    const employeeId = typeof body.employeeId === 'string' || typeof body.employeeId === 'number'
      ? body.employeeId
      : undefined;
    const date = typeof body.date === 'string' ? body.date : undefined;
    const workDate = typeof body.workDate === 'string' ? body.workDate : undefined;
    const shiftType = typeof body.shiftType === 'string' ? body.shiftType : 'A';
    const scheduleDate = date || workDate; // 支援 date 和 workDate 兩種欄位名
    const workDatesResult = normalizeWorkDates(body.workDates);
    const scheduleEntriesResult = normalizeScheduleEntries(body.entries);
    const employeeIdsResult = normalizeEmployeeIdentifiers(body.employeeIds);
    const dryRun = body.dryRun === true;

    if (!workDatesResult.isValid) {
      return NextResponse.json(
        { success: false, error: 'workDates 格式錯誤' },
        { status: 400 }
      );
    }

    if (!scheduleEntriesResult.isValid) {
      return NextResponse.json(
        { success: false, error: scheduleEntriesResult.error ?? 'entries 格式錯誤' },
        { status: 400 }
      );
    }

    if (!employeeIdsResult.isValid) {
      return NextResponse.json(
        { success: false, error: 'employeeIds 格式錯誤' },
        { status: 400 }
      );
    }

    const entryShiftTypes = scheduleEntriesResult.provided
      ? Array.from(new Set(scheduleEntriesResult.entries.map((entry) => entry.shiftType)))
      : [shiftType];
    const shiftDefinitions = await Promise.all(entryShiftTypes.map(async (code) => ({
      code,
      definition: await findActiveShiftDefinition(code),
    })));
    const invalidShift = shiftDefinitions.find((item) => !item.definition);
    if (invalidShift) {
      return NextResponse.json(
        { success: false, error: '班別不存在或已停用，請先至班別設定確認' },
        { status: 400 }
      );
    }

    const shiftFieldMap = new Map(
      shiftDefinitions.map((item) => {
        const definition = item.definition!;
        const syncedFields = buildScheduleFieldsFromShiftDefinition(definition);
        return [item.code, {
          ...syncedFields,
          startTime: definition.requiresTime ? syncedFields.startTime : '',
          endTime: definition.requiresTime ? syncedFields.endTime : '',
          breakTime: definition.requiresTime ? syncedFields.breakTime : 0,
        }];
      })
    );
    const timedShiftWithoutHours = shiftDefinitions.find((item) => {
      const definition = item.definition!;
      const syncedFields = shiftFieldMap.get(item.code);
      return definition.requiresTime && (!syncedFields?.startTime || !syncedFields?.endTime);
    });
    if (timedShiftWithoutHours) {
      return NextResponse.json(
        { success: false, error: '此班別類型需要填寫開始時間和結束時間' },
        { status: 400 }
      );
    }

    const targetDates = scheduleEntriesResult.provided
      ? scheduleEntriesResult.entries.map((entry) => entry.workDate)
      : workDatesResult.provided
        ? workDatesResult.dates
        : scheduleDate
          ? [scheduleDate]
          : [];
    const targetEmployeeIdentifiers = employeeIdsResult.provided
      ? employeeIdsResult.employeeIds
      : employeeId !== undefined
        ? [String(employeeId).trim()]
        : [];

    if (targetEmployeeIdentifiers.length === 0 || targetDates.length === 0) {
      return NextResponse.json(
        { success: false, error: '員工ID和日期為必填項目' },
        { status: 400 }
      );
    }

    const freezeError = getAttendanceFreezeError(
      await checkMultipleDatesFreeze(targetDates.map(toAttendanceDate))
    );
    if (freezeError) {
      return NextResponse.json({ success: false, error: freezeError }, { status: 409 });
    }

    const createdScheduleResult = await prisma.$transaction(async (tx) => {
      const numericEmployeeIds = targetEmployeeIdentifiers
        .map((identifier) => parseIntegerQueryParam(identifier, { min: 1, max: 99999999 }))
        .filter((result) => result.isValid && result.value !== null)
        .map((result) => result.value as number);
      const employeeCodeIdentifiers = targetEmployeeIdentifiers.filter((identifier) => (
        !numericEmployeeIds.includes(Number(identifier))
      ));
      const employeeWhereClauses: Array<Record<string, unknown>> = [];

      if (numericEmployeeIds.length > 0) {
        employeeWhereClauses.push({ id: { in: numericEmployeeIds } });
      }

      if (employeeCodeIdentifiers.length > 0) {
        employeeWhereClauses.push({ employeeId: { in: employeeCodeIdentifiers } });
      }

      const employees = await tx.employee.findMany({
        where: employeeWhereClauses.length === 1
          ? employeeWhereClauses[0]
          : { OR: employeeWhereClauses },
        select: {
          id: true,
          employeeId: true,
          name: true,
          department: true,
          isActive: true,
        }
      });

      const matchedIdentifiers = new Set<string>();
      employees.forEach((employee) => {
        matchedIdentifiers.add(String(employee.id));
        matchedIdentifiers.add(employee.employeeId);
      });

      const unresolvedIdentifiers = targetEmployeeIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier));
      const inactiveEmployees = employees.filter((employee) => employee.isActive === false);

      if (unresolvedIdentifiers.length > 0 || inactiveEmployees.length > 0) {
        const invalidEmployees = [
          ...unresolvedIdentifiers,
          ...inactiveEmployees.map((employee) => `${employee.name}（${employee.employeeId}）`),
        ];
        return {
          ok: false as const,
          status: 404,
          body: {
            success: false,
            error: `以下員工不存在或已停用：${invalidEmployees.slice(0, 5).join('、')}${invalidEmployees.length > 5 ? ` 等 ${invalidEmployees.length} 人` : ''}`,
          }
        };
      }

      const activeEmployees = employees.filter((employee) => employee.isActive !== false);

      const permissionCheckTime = new Date();
      for (const employee of activeEmployees) {
        const canManage = await canManageScheduleEmployee(user, employee.id, permissionCheckTime, tx);
        if (!canManage) {
          const manageableDepartments = await getManageableDepartments(user, permissionCheckTime, tx);
          return {
            ok: false as const,
            status: 403,
            body: {
              success: false,
              error: buildSchedulePermissionDeniedMessage(employee, manageableDepartments),
            }
          };
        }
      }

      const targetEmployeeIds = activeEmployees.map((employee) => employee.id);
      const firstEmployee = activeEmployees[0];

      if (targetEmployeeIds.length === 1 && firstEmployee && targetDates.length === 1) {
        const targetEntry = scheduleEntriesResult.provided
          ? scheduleEntriesResult.entries[0]
          : { workDate: targetDates[0], shiftType };
        const syncedShiftFields = buildSyncedShiftFields(targetEntry.shiftType, shiftFieldMap);
        const existingSchedule = await tx.schedule.findUnique({
          where: {
            employeeId_workDate: {
              employeeId: firstEmployee.id,
              workDate: targetEntry.workDate
            }
          }
        });

        if (existingSchedule) {
          if (dryRun) {
            return {
              ok: true as const,
              dryRun: true,
              employeeIds: targetEmployeeIds,
              createdDates: [targetEntry.workDate],
              createdCount: 0,
              updatedCount: 1,
              appliedCount: 1,
              employeeCount: 1,
              conflicts: [{
                employeeId: firstEmployee.id,
                employeeCode: firstEmployee.employeeId,
                employeeName: firstEmployee.name,
                workDate: targetEntry.workDate,
                oldShiftType: existingSchedule.shiftType,
                newShiftType: targetEntry.shiftType,
              }],
            };
          }

          return {
            ok: false as const,
            status: 400,
            body: { success: false, error: '該員工在此日期已有排程' }
          };
        }

        if (dryRun) {
          return {
            ok: true as const,
            dryRun: true,
            employeeIds: targetEmployeeIds,
            createdDates: [targetEntry.workDate],
            createdCount: 1,
            updatedCount: 0,
            appliedCount: 1,
            employeeCount: 1,
            conflicts: [],
          };
        }

        const schedule = await tx.schedule.create({
          data: {
            employeeId: firstEmployee.id,
            workDate: targetEntry.workDate,
            ...syncedShiftFields,
          },
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                name: true,
                department: true
              }
            }
          }
        });

        return {
          ok: true as const,
          employeeIds: targetEmployeeIds,
          createdDates: [targetEntry.workDate],
          schedule
        };
      }

      const existingSchedules = await tx.schedule.findMany({
        where: {
          employeeId: { in: targetEmployeeIds },
          workDate: { in: targetDates }
        },
        select: {
          employeeId: true,
          workDate: true,
          shiftType: true,
          employee: {
            select: {
              employeeId: true,
              name: true,
            }
          }
        }
      });

      const existingScheduleKeys = new Set(
        existingSchedules.map((schedule) => `${schedule.employeeId}:${schedule.workDate}`)
      );
      const targetEntries = scheduleEntriesResult.provided
        ? scheduleEntriesResult.entries
        : targetDates.map((targetDate) => ({ workDate: targetDate, shiftType }));
      const targetEntryByDate = new Map(targetEntries.map((targetEntry) => [targetEntry.workDate, targetEntry]));
      const createPayload = targetEmployeeIds.flatMap((targetEmployeeId) => targetEntries
        .filter((targetEntry) => !existingScheduleKeys.has(`${targetEmployeeId}:${targetEntry.workDate}`))
        .map((targetEntry) => ({
          employeeId: targetEmployeeId,
          workDate: targetEntry.workDate,
          ...buildSyncedShiftFields(targetEntry.shiftType, shiftFieldMap),
        })));

      if (dryRun) {
        return {
          ok: true as const,
          dryRun: true,
          employeeIds: targetEmployeeIds,
          createdDates: targetDates,
          createdCount: createPayload.length,
          updatedCount: existingSchedules.length,
          appliedCount: createPayload.length + existingSchedules.length,
          employeeCount: targetEmployeeIds.length,
          conflicts: existingSchedules.map((schedule) => ({
            employeeId: schedule.employeeId,
            employeeCode: schedule.employee.employeeId,
            employeeName: schedule.employee.name,
            workDate: schedule.workDate,
            oldShiftType: schedule.shiftType,
            newShiftType: targetEntryByDate.get(schedule.workDate)?.shiftType ?? shiftType,
          })),
        };
      }

      let updatedCount = 0;
      if (existingSchedules.length > 0) {
        const entriesByShiftType = new Map<string, string[]>();
        targetEntries.forEach((targetEntry) => {
          const dates = entriesByShiftType.get(targetEntry.shiftType) ?? [];
          dates.push(targetEntry.workDate);
          entriesByShiftType.set(targetEntry.shiftType, dates);
        });

        for (const [entryShiftType, groupedDates] of entriesByShiftType.entries()) {
          const updateResult = await tx.schedule.updateMany({
            where: {
              employeeId: { in: targetEmployeeIds },
              workDate: { in: Array.from(new Set(groupedDates)) }
            },
            data: buildSyncedShiftFields(entryShiftType, shiftFieldMap)
          });
          updatedCount += updateResult.count;
        }
      }

      const createResult = createPayload.length > 0
        ? await tx.schedule.createMany({ data: createPayload })
        : { count: 0 };

      return {
        ok: true as const,
        employeeIds: targetEmployeeIds,
        createdDates: targetDates,
        createdCount: createResult.count,
        updatedCount,
        appliedCount: createResult.count + updatedCount,
        employeeCount: targetEmployeeIds.length,
      };
    });

    if (!createdScheduleResult.ok) {
      return NextResponse.json(createdScheduleResult.body, { status: createdScheduleResult.status });
    }

    if ('dryRun' in createdScheduleResult && createdScheduleResult.dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        createdCount: createdScheduleResult.createdCount,
        updatedCount: createdScheduleResult.updatedCount,
        appliedCount: createdScheduleResult.appliedCount,
        employeeCount: createdScheduleResult.employeeCount,
        workDates: createdScheduleResult.createdDates,
        conflicts: createdScheduleResult.conflicts,
      });
    }

    // 觸發班表確認失效（新增班表後需重新確認）
    await Promise.all(
      createdScheduleResult.employeeIds.flatMap((resolvedEmployeeId) => (
        getYearMonthsFromDates(createdScheduleResult.createdDates).map((yearMonth) => (
          invalidateConfirmation(resolvedEmployeeId, yearMonth)
        ))
      ))
    );

    const createdSingleSchedule = 'schedule' in createdScheduleResult ? createdScheduleResult.schedule : null;

    if (createdSingleSchedule) {
      return NextResponse.json({
        success: true,
        message: '排程新增成功',
        schedule: {
          id: createdSingleSchedule.id,
          employeeId: createdSingleSchedule.employee.employeeId,
          employeeName: createdSingleSchedule.employee.name,
          department: createdSingleSchedule.employee.department,
          date: createdSingleSchedule.workDate,
          startTime: createdSingleSchedule.startTime,
          endTime: createdSingleSchedule.endTime,
          breakTime: createdSingleSchedule.breakTime,
          workHours: createdSingleSchedule.workHours,
          specialLeaveHours: createdSingleSchedule.specialLeaveHours,
          compLeaveHours: createdSingleSchedule.compLeaveHours,
          overtimeHours: createdSingleSchedule.overtimeHours,
          shiftType: createdSingleSchedule.shiftType,
          status: 'active'
        }
      }, { status: 201 });
    }

    const batchResult = createdScheduleResult as typeof createdScheduleResult & {
      createdCount: number;
      updatedCount?: number;
      appliedCount?: number;
      employeeCount?: number;
      employeeIds: number[];
      createdDates: string[];
    };

    return NextResponse.json({
      success: true,
      message: batchResult.employeeCount && batchResult.employeeCount > 1
        ? `已為 ${batchResult.employeeCount} 位員工同步 ${batchResult.appliedCount ?? batchResult.createdCount} 筆排程（新增 ${batchResult.createdCount} 筆、更新 ${batchResult.updatedCount ?? 0} 筆）`
        : (batchResult.updatedCount ?? 0) > 0
          ? `已同步 ${batchResult.appliedCount ?? batchResult.createdCount} 筆排程（新增 ${batchResult.createdCount} 筆、更新 ${batchResult.updatedCount ?? 0} 筆）`
          : `已新增 ${batchResult.createdCount} 筆排程`,
      createdCount: batchResult.createdCount,
      updatedCount: batchResult.updatedCount ?? 0,
      appliedCount: batchResult.appliedCount ?? batchResult.createdCount,
      employeeCount: batchResult.employeeCount ?? batchResult.employeeIds.length,
      workDates: batchResult.createdDates,
    }, { status: 201 });
  } catch (error) {
    console.error('新增排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// PUT: 更新排程
export async function PUT(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error === 'empty_body' ? '請提供有效的排程資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { success: false, error: '請提供有效的排程資料' },
        { status: 400 }
      );
    }

    const id = typeof body.id === 'string' || typeof body.id === 'number' ? body.id : undefined;
    const startTime = typeof body.startTime === 'string' ? body.startTime : undefined;
    const endTime = typeof body.endTime === 'string' ? body.endTime : undefined;
    const shiftType = typeof body.shiftType === 'string' ? body.shiftType : undefined;
    const breakTime = typeof body.breakTime === 'number' ? body.breakTime : undefined;
    const workHours = parseHour(body.workHours);
    const specialLeaveHours = parseHour(body.specialLeaveHours);
    const compLeaveHours = parseHour(body.compLeaveHours);
    const overtimeHours = parseHour(body.overtimeHours);
    const employeeId = typeof body.employeeId === 'string' || typeof body.employeeId === 'number'
      ? body.employeeId
      : undefined;
    const workDatesResult = normalizeWorkDates(body.workDates);
    const scheduleEntriesResult = normalizeScheduleEntries(body.entries);

    if (!workDatesResult.isValid) {
      return NextResponse.json(
        { success: false, error: 'workDates 格式錯誤' },
        { status: 400 }
      );
    }

    if (!scheduleEntriesResult.isValid) {
      return NextResponse.json(
        { success: false, error: scheduleEntriesResult.error ?? 'entries 格式錯誤' },
        { status: 400 }
      );
    }

    if (id && scheduleEntriesResult.provided) {
      return NextResponse.json(
        { success: false, error: '單筆更新不可同時提供 entries' },
        { status: 400 }
      );
    }

    if (!id && (!employeeId || (!scheduleEntriesResult.provided && workDatesResult.dates.length === 0) || (scheduleEntriesResult.provided && scheduleEntriesResult.entries.length === 0))) {
      return NextResponse.json(
        { success: false, error: '排程ID為必填' },
        { status: 400 }
      );
    }

    if (id) {
      const scheduleIdResult = parseIntegerQueryParam(String(id), { min: 1, max: 99999999 });
      if (!scheduleIdResult.isValid || scheduleIdResult.value === null) {
        return NextResponse.json(
          { success: false, error: '排程ID格式錯誤' },
          { status: 400 }
        );
      }
      const scheduleId = scheduleIdResult.value;
      const updatedScheduleResult = await prisma.$transaction(async (tx) => {
        const existingSchedule = await tx.schedule.findUnique({
          where: { id: scheduleId },
          include: { employee: { select: { id: true, employeeId: true, name: true, department: true } } }
        });

        if (!existingSchedule) {
          return {
            ok: false as const,
            status: 404,
            body: { success: false, error: '找不到排程' }
          };
        }

        const freezeError = getAttendanceFreezeError(
          await checkAttendanceFreeze(toAttendanceDate(existingSchedule.workDate))
        );
        if (freezeError) {
          return {
            ok: false as const,
            status: 409,
            body: { success: false, error: freezeError }
          };
        }

        const permissionCheckTime = new Date();
        const canManage = await canManageScheduleEmployee(user, existingSchedule.employeeId, permissionCheckTime, tx);
        if (!canManage) {
          const manageableDepartments = await getManageableDepartments(user, permissionCheckTime, tx);
          return {
            ok: false as const,
            status: 403,
            body: {
              success: false,
              error: buildSchedulePermissionDeniedMessage(existingSchedule.employee, manageableDepartments),
            }
          };
        }

        const shiftTypeChanged = shiftType !== undefined && shiftType !== existingSchedule.shiftType;
        const shiftDefinition = shiftTypeChanged
          ? await tx.shiftDefinition.findFirst({ where: { code: shiftType, isActive: true } })
          : null;

        if (shiftTypeChanged && !shiftDefinition) {
          return {
            ok: false as const,
            status: 400,
            body: { success: false, error: '班別不存在或已停用，請先至班別設定確認' }
          };
        }

        const updateData = {
          ...(shiftDefinition && buildScheduleFieldsFromShiftDefinition(shiftDefinition)),
          ...(shiftType !== undefined && !shiftDefinition && { shiftType }),
          ...(startTime !== undefined && { startTime }),
          ...(endTime !== undefined && { endTime }),
          ...(breakTime !== undefined && { breakTime }),
          ...(workHours !== undefined && { workHours }),
          ...(specialLeaveHours !== undefined && { specialLeaveHours }),
          ...(compLeaveHours !== undefined && { compLeaveHours }),
          ...(overtimeHours !== undefined && { overtimeHours })
        };

        const nextSchedule = { ...existingSchedule, ...updateData };
        const manuallyChangedHours = startTime !== undefined || endTime !== undefined || breakTime !== undefined || workHours !== undefined;
        if (
          manuallyChangedHours
          && typeof nextSchedule.startTime === 'string'
          && typeof nextSchedule.endTime === 'string'
          && typeof nextSchedule.breakTime === 'number'
          && typeof nextSchedule.workHours === 'number'
          && !isScheduleHourConsistent(nextSchedule.startTime, nextSchedule.endTime, nextSchedule.breakTime, nextSchedule.workHours)
        ) {
          return {
            ok: false as const,
            status: 400,
            body: { success: false, error: '工時與上下班時間、休息時間不一致' }
          };
        }

        const schedule = await tx.schedule.update({
          where: { id: scheduleId },
          data: updateData,
          include: {
            employee: {
              select: {
                employeeId: true,
                name: true,
                department: true
              }
            }
          }
        });

        return {
          ok: true as const,
          schedule
        };
      });

      if (!updatedScheduleResult.ok) {
        return NextResponse.json(updatedScheduleResult.body, { status: updatedScheduleResult.status });
      }

      // 觸發班表確認失效
      const yearMonth = updatedScheduleResult.schedule.workDate.substring(0, 7);
      await invalidateConfirmation(updatedScheduleResult.schedule.employeeId, yearMonth);

      return NextResponse.json({
        success: true,
        message: '排程更新成功',
        schedule: updatedScheduleResult.schedule
      });
    }

    const rawNumericEmployeeId = typeof employeeId === 'number' ? String(employeeId) : typeof employeeId === 'string' ? employeeId : null;
    const employeeIdResult = rawNumericEmployeeId !== null
      ? parseIntegerQueryParam(rawNumericEmployeeId, { min: 1, max: 99999999 })
      : { value: null, isValid: false };

    if (!employeeIdResult.isValid || employeeIdResult.value === null) {
      return NextResponse.json(
        { success: false, error: '員工ID格式錯誤' },
        { status: 400 }
      );
    }

    const freezeError = getAttendanceFreezeError(
      await checkMultipleDatesFreeze(
        (scheduleEntriesResult.provided
          ? scheduleEntriesResult.entries.map((entry) => entry.workDate)
          : workDatesResult.dates
        ).map(toAttendanceDate)
      )
    );
    if (freezeError) {
      return NextResponse.json({ success: false, error: freezeError }, { status: 409 });
    }

    const targetEntries = scheduleEntriesResult.provided
      ? scheduleEntriesResult.entries
      : workDatesResult.dates.map((targetDate) => ({
          workDate: targetDate,
          shiftType: shiftType ?? '',
        }));
    const entryShiftTypes = scheduleEntriesResult.provided
      ? Array.from(new Set(targetEntries.map((entry) => entry.shiftType)))
      : shiftType
        ? [shiftType]
        : [];
    const shiftDefinitions = await Promise.all(entryShiftTypes.map(async (code) => ({
      code,
      definition: await findActiveShiftDefinition(code),
    })));
    const invalidShift = shiftDefinitions.find((item) => !item.definition);
    if (invalidShift) {
      return NextResponse.json(
        { success: false, error: '班別不存在或已停用，請先至班別設定確認' },
        { status: 400 }
      );
    }
    const shiftFieldMap = new Map(
      shiftDefinitions.map((item) => {
        const definition = item.definition!;
        const syncedFields = buildScheduleFieldsFromShiftDefinition(definition);
        return [item.code, {
          ...syncedFields,
          startTime: definition.requiresTime ? syncedFields.startTime : '',
          endTime: definition.requiresTime ? syncedFields.endTime : '',
          breakTime: definition.requiresTime ? syncedFields.breakTime : 0,
        }];
      })
    );
    const timedShiftWithoutHours = shiftDefinitions.find((item) => {
      const definition = item.definition!;
      const syncedFields = shiftFieldMap.get(item.code);
      return definition.requiresTime && (!syncedFields?.startTime || !syncedFields?.endTime);
    });
    if (timedShiftWithoutHours) {
      return NextResponse.json(
        { success: false, error: '此班別類型需要填寫開始時間和結束時間' },
        { status: 400 }
      );
    }

    const updatedScheduleResult = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: {
          OR: [
            { id: employeeIdResult.value ?? undefined },
            { employeeId: typeof employeeId === 'string' ? employeeId : undefined }
          ]
        },
        select: {
          id: true,
          employeeId: true,
          name: true,
          department: true
        }
      });

      if (!employee) {
        return {
          ok: false as const,
          status: 404,
          body: { success: false, error: '找不到該員工' }
        };
      }

      const permissionCheckTime = new Date();
      const canManage = await canManageScheduleEmployee(user, employee.id, permissionCheckTime, tx);
      if (!canManage) {
        const manageableDepartments = await getManageableDepartments(user, permissionCheckTime, tx);
        return {
          ok: false as const,
          status: 403,
          body: {
            success: false,
            error: buildSchedulePermissionDeniedMessage(employee, manageableDepartments),
          }
        };
      }

      const existingSchedules = await tx.schedule.findMany({
        where: {
          employeeId: employee.id,
          workDate: { in: workDatesResult.dates }
        },
        select: {
          id: true,
          workDate: true,
          shiftType: true
        }
      });

      let updatedCount = 0;
      const existingScheduleDates = new Set(existingSchedules.map((schedule) => schedule.workDate));
      const missingEntries = targetEntries.filter((entry) => !existingScheduleDates.has(entry.workDate));

      if (scheduleEntriesResult.provided) {
        const entryByDate = new Map(targetEntries.map((entry) => [entry.workDate, entry]));
        const scheduleIdsByShiftType = new Map<string, number[]>();

        existingSchedules.forEach((schedule) => {
          const matchedEntry = entryByDate.get(schedule.workDate);
          if (!matchedEntry) {
            return;
          }

          const scheduleIds = scheduleIdsByShiftType.get(matchedEntry.shiftType) ?? [];
          scheduleIds.push(schedule.id);
          scheduleIdsByShiftType.set(matchedEntry.shiftType, scheduleIds);
        });

        for (const [entryShiftType, scheduleIds] of scheduleIdsByShiftType.entries()) {
          const updateResult = await tx.schedule.updateMany({
            where: {
              id: { in: scheduleIds }
            },
            data: buildSyncedShiftFields(entryShiftType, shiftFieldMap),
          });
          updatedCount += updateResult.count;
        }
      } else {
        const shiftTypeChanged = shiftType !== undefined && existingSchedules.some((schedule) => schedule.shiftType !== shiftType);
        const shiftDefinition = shiftTypeChanged
          ? await tx.shiftDefinition.findFirst({ where: { code: shiftType, isActive: true } })
          : null;

        if (shiftTypeChanged && !shiftDefinition) {
          return {
            ok: false as const,
            status: 400,
            body: { success: false, error: '班別不存在或已停用，請先至班別設定確認' }
          };
        }

        const updateData = {
          ...(shiftDefinition && buildScheduleFieldsFromShiftDefinition(shiftDefinition)),
          ...(shiftType !== undefined && !shiftDefinition && { shiftType }),
          ...(startTime !== undefined && { startTime }),
          ...(endTime !== undefined && { endTime }),
          ...(breakTime !== undefined && { breakTime }),
          ...(workHours !== undefined && { workHours }),
          ...(specialLeaveHours !== undefined && { specialLeaveHours }),
          ...(compLeaveHours !== undefined && { compLeaveHours }),
          ...(overtimeHours !== undefined && { overtimeHours })
        };

        const updateResult = await tx.schedule.updateMany({
          where: {
            id: { in: existingSchedules.map((schedule) => schedule.id) }
          },
          data: updateData,
        });
        updatedCount = updateResult.count;
      }

      const createPayload = missingEntries.map((entry) => ({
        employeeId: employee.id,
        workDate: entry.workDate,
        ...buildSyncedShiftFields(entry.shiftType, shiftFieldMap),
      }));
      const createResult = createPayload.length > 0
        ? await tx.schedule.createMany({ data: createPayload })
        : { count: 0 };

      return {
        ok: true as const,
        employeeId: employee.id,
        updatedCount,
        createdCount: createResult.count,
        updatedDates: existingSchedules.map((schedule) => schedule.workDate),
        createdDates: missingEntries.map((entry) => entry.workDate),
        appliedDates: Array.from(new Set([
          ...existingSchedules.map((schedule) => schedule.workDate),
          ...missingEntries.map((entry) => entry.workDate),
        ])),
      };
    });

    if (!updatedScheduleResult.ok) {
      return NextResponse.json(updatedScheduleResult.body, { status: updatedScheduleResult.status });
    }

    // 觸發班表確認失效
    await Promise.all(
      getYearMonthsFromDates(updatedScheduleResult.appliedDates).map((yearMonth) => (
        invalidateConfirmation(updatedScheduleResult.employeeId, yearMonth)
      ))
    );

    const appliedCount = updatedScheduleResult.updatedCount + updatedScheduleResult.createdCount;
    return NextResponse.json({
      success: true,
      message: updatedScheduleResult.createdCount > 0
        ? `已同步 ${appliedCount} 筆班表（更新 ${updatedScheduleResult.updatedCount} 筆、新增 ${updatedScheduleResult.createdCount} 筆）`
        : `已更新 ${updatedScheduleResult.updatedCount} 筆班表`,
      updatedCount: updatedScheduleResult.updatedCount,
      createdCount: updatedScheduleResult.createdCount,
      appliedCount,
      updatedDates: updatedScheduleResult.updatedDates,
      createdDates: updatedScheduleResult.createdDates,
      missingDates: [],
    });
  } catch (error) {
    console.error('更新排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// DELETE: 刪除排程
export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const scheduleIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
      if (!scheduleIdResult.isValid || scheduleIdResult.value === null) {
        return NextResponse.json(
          { success: false, error: '排程ID格式錯誤' },
          { status: 400 }
        );
      }
      const scheduleId = scheduleIdResult.value;

      const deletedScheduleResult = await prisma.$transaction(async (tx) => {
        const scheduleToDelete = await tx.schedule.findUnique({
          where: { id: scheduleId },
          include: { employee: { select: { id: true, department: true } } }
        });

        if (!scheduleToDelete) {
          return {
            ok: false as const,
            status: 404,
            body: { success: false, error: '找不到該排程' }
          };
        }

        const freezeError = getAttendanceFreezeError(
          await checkAttendanceFreeze(toAttendanceDate(scheduleToDelete.workDate))
        );
        if (freezeError) {
          return {
            ok: false as const,
            status: 409,
            body: { success: false, error: freezeError }
          };
        }

        const canManage = await canManageScheduleEmployee(user, scheduleToDelete.employeeId, new Date(), tx);
        if (!canManage) {
          return {
            ok: false as const,
            status: 403,
            body: { error: '無權限刪除該員工的排程' }
          };
        }

        await tx.schedule.delete({
          where: { id: scheduleId }
        });

        return {
          ok: true as const,
          schedule: scheduleToDelete
        };
      });

      if (!deletedScheduleResult.ok) {
        return NextResponse.json(deletedScheduleResult.body, { status: deletedScheduleResult.status });
      }

      // 觸發班表確認失效
      const yearMonth = deletedScheduleResult.schedule.workDate.substring(0, 7);
      await invalidateConfirmation(deletedScheduleResult.schedule.employeeId, yearMonth);

      return NextResponse.json({
        success: true,
        message: '排程刪除成功'
      });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error === 'empty_body' ? '請提供有效的刪除條件' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { success: false, error: '請提供有效的刪除條件' },
        { status: 400 }
      );
    }

    const employeeId = typeof body.employeeId === 'string' || typeof body.employeeId === 'number'
      ? body.employeeId
      : undefined;
    const workDate = typeof body.workDate === 'string' ? body.workDate : undefined;
    const employeeIdsResult = normalizeEmployeeIdentifiers(body.employeeIds);
    const workDatesResult = normalizeWorkDates(body.workDates);

    if (!employeeIdsResult.isValid) {
      return NextResponse.json(
        { success: false, error: 'employeeIds 格式錯誤' },
        { status: 400 }
      );
    }

    if (!workDatesResult.isValid) {
      return NextResponse.json(
        { success: false, error: 'workDates 格式錯誤' },
        { status: 400 }
      );
    }

    const targetEmployeeIdentifiers = employeeIdsResult.provided
      ? employeeIdsResult.employeeIds
      : employeeId !== undefined
        ? [String(employeeId).trim()]
        : [];
    const targetDates = workDatesResult.provided
      ? workDatesResult.dates
      : workDate
        ? [workDate]
        : [];

    if (targetEmployeeIdentifiers.length === 0 || targetDates.length === 0) {
      return NextResponse.json(
        { success: false, error: '員工ID和日期為必填項目' },
        { status: 400 }
      );
    }

    const freezeError = getAttendanceFreezeError(
      await checkMultipleDatesFreeze(targetDates.map(toAttendanceDate))
    );
    if (freezeError) {
      return NextResponse.json({ success: false, error: freezeError }, { status: 409 });
    }

    const deletedScheduleResult = await prisma.$transaction(async (tx) => {
      const numericEmployeeIds = targetEmployeeIdentifiers
        .map((identifier) => parseIntegerQueryParam(identifier, { min: 1, max: 99999999 }))
        .filter((result) => result.isValid && result.value !== null)
        .map((result) => result.value as number);
      const employeeCodeIdentifiers = targetEmployeeIdentifiers.filter((identifier) => (
        !numericEmployeeIds.includes(Number(identifier))
      ));
      const employeeWhereClauses: Array<Record<string, unknown>> = [];

      if (numericEmployeeIds.length > 0) {
        employeeWhereClauses.push({ id: { in: numericEmployeeIds } });
      }

      if (employeeCodeIdentifiers.length > 0) {
        employeeWhereClauses.push({ employeeId: { in: employeeCodeIdentifiers } });
      }

      const employees = await tx.employee.findMany({
        where: employeeWhereClauses.length === 1
          ? employeeWhereClauses[0]
          : { OR: employeeWhereClauses },
        select: {
          id: true,
          employeeId: true,
          name: true,
          department: true,
        }
      });

      const matchedIdentifiers = new Set<string>();
      employees.forEach((employee) => {
        matchedIdentifiers.add(String(employee.id));
        matchedIdentifiers.add(employee.employeeId);
      });

      const unresolvedIdentifiers = targetEmployeeIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier));
      if (unresolvedIdentifiers.length > 0) {
        return {
          ok: false as const,
          status: 404,
          body: {
            success: false,
            error: `以下員工不存在：${unresolvedIdentifiers.slice(0, 5).join('、')}${unresolvedIdentifiers.length > 5 ? ` 等 ${unresolvedIdentifiers.length} 人` : ''}`,
          }
        };
      }

      const permissionCheckTime = new Date();
      for (const employee of employees) {
        const canManage = await canManageScheduleEmployee(user, employee.id, permissionCheckTime, tx);
        if (!canManage) {
          const manageableDepartments = await getManageableDepartments(user, permissionCheckTime, tx);
          return {
            ok: false as const,
            status: 403,
            body: {
              success: false,
              error: buildSchedulePermissionDeniedMessage(employee, manageableDepartments),
            }
          };
        }
      }

      const schedules = await tx.schedule.findMany({
        where: {
          employeeId: { in: employees.map((employee) => employee.id) },
          workDate: { in: targetDates },
        },
        select: {
          id: true,
          employeeId: true,
          workDate: true,
        }
      });

      if (schedules.length === 0) {
        return {
          ok: true as const,
          deletedCount: 0,
          employeeIds: [] as number[],
          deletedDates: [] as string[],
          employeeCount: employees.length,
        };
      }

      const deleteResult = await tx.schedule.deleteMany({
        where: {
          id: { in: schedules.map((schedule) => schedule.id) }
        }
      });

      return {
        ok: true as const,
        deletedCount: deleteResult.count,
        employeeIds: Array.from(new Set(schedules.map((schedule) => schedule.employeeId))),
        deletedDates: Array.from(new Set(schedules.map((schedule) => schedule.workDate))),
        employeeCount: Array.from(new Set(schedules.map((schedule) => schedule.employeeId))).length,
      };
    });

    if (!deletedScheduleResult.ok) {
      return NextResponse.json(deletedScheduleResult.body, { status: deletedScheduleResult.status });
    }

    await Promise.all(
      deletedScheduleResult.employeeIds.flatMap((resolvedEmployeeId) => (
        getYearMonthsFromDates(deletedScheduleResult.deletedDates).map((yearMonth) => (
          invalidateConfirmation(resolvedEmployeeId, yearMonth)
        ))
      ))
    );

    if (deletedScheduleResult.deletedCount === 0) {
      return NextResponse.json({
        success: true,
        message: '查無符合條件的班表，未刪除任何資料',
        deletedCount: 0,
        employeeCount: deletedScheduleResult.employeeCount,
        workDates: [],
      });
    }

    return NextResponse.json({
      success: true,
      message: `已刪除 ${deletedScheduleResult.employeeCount} 位員工共 ${deletedScheduleResult.deletedCount} 筆班表`,
      deletedCount: deletedScheduleResult.deletedCount,
      employeeCount: deletedScheduleResult.employeeCount,
      workDates: deletedScheduleResult.deletedDates,
    });
  } catch (error) {
    console.error('刪除排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}
