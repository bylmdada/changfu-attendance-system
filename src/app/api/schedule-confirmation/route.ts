import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  getScheduleConfirmSettings,
  sendSchedulePublishNotification,
  sendReminderToUnconfirmed,
} from '@/lib/schedule-confirm-service';
import { listShiftDefinitions } from '@/lib/shift-definition-service';
import { resolveScheduleHourFields } from '@/lib/shift-definition-utils';
import { parseYearMonthQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import {
  type ScheduleConfirmStatus,
  SCHEDULE_ALL_DEPARTMENTS,
  getScheduleReleaseDepartmentFilters,
  isScheduleConfirmStatus,
  pickApplicableScheduleRelease,
} from '@/lib/schedule-confirmation-status';
import { getTaiwanMonthEnd } from '@/lib/timezone';

/**
 * 班表確認 API
 * 
 * GET: 查詢確認狀態
 * POST: 確認班表 / 發布班表
 */

// 取得某月最後一天
function getLastDayOfMonth(yearMonth: string): Date {
  const [year, month] = yearMonth.split('-').map(Number);
  const deadline = getTaiwanMonthEnd(year, month);
  deadline.setUTCMilliseconds(0);
  return deadline;
}

function getMonthDateRange(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: `${yearMonth}-01`,
    end: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

interface ConfirmationRecord {
  id: number;
  version: number;
  confirmedAt: Date;
  isValid: boolean;
  comment: string | null;
}

interface ReleaseRecord {
  id: number;
  version: number;
  deadline: Date | null;
}

interface ScheduleMonthlyReleaseRecord extends ReleaseRecord {
  yearMonth: string;
  department: string | null;
  publishedAt: Date;
  lastModified: Date;
  publishedBy: {
    name: string;
  };
  confirmations?: ConfirmationRecord[];
}

interface EmployeeConfirmationRecord {
  id: number;
  employeeId: number;
  yearMonth: string;
  releaseId: number;
  version: number;
  confirmedAt: Date;
  comment: string | null;
  isValid: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getConfirmStatus(release: ReleaseRecord | null, confirmation: ConfirmationRecord | null): ScheduleConfirmStatus {
  if (!release) return 'NOT_RELEASED';
  
  if (!confirmation) {
    const now = new Date();
    if (release.deadline && now > release.deadline) {
      return 'EXPIRED';
    }
    return 'PENDING';
  }
  
  // 班表版本大於確認時的版本 = 需重新確認
  if (release.version > confirmation.version) {
    return 'NEED_RECONFIRM';
  }
  
  if (!confirmation.isValid) {
    return 'NEED_RECONFIRM';
  }
  
  return 'CONFIRMED';
}

function parseStatusFilter(value: string | null): ScheduleConfirmStatus | null {
  if (!value) return null;
  return isScheduleConfirmStatus(value) ? value : null;
}

function groupReleasesByMonth(releases: ScheduleMonthlyReleaseRecord[]) {
  return releases.reduce<Map<string, ScheduleMonthlyReleaseRecord[]>>((result, release) => {
    const existing = result.get(release.yearMonth);
    if (existing) {
      existing.push(release);
    } else {
      result.set(release.yearMonth, [release]);
    }
    return result;
  }, new Map());
}

function serializeRelease(release: ScheduleMonthlyReleaseRecord | null) {
  if (!release) {
    return null;
  }

  return {
    id: release.id,
    yearMonth: release.yearMonth,
    department: release.department === SCHEDULE_ALL_DEPARTMENTS ? null : release.department,
    publishedAt: release.publishedAt.toISOString(),
    deadline: release.deadline?.toISOString() ?? null,
    version: release.version,
    lastModified: release.lastModified.toISOString(),
    publisherName: release.publishedBy.name,
  };
}

function serializeConfirmation(confirmation: EmployeeConfirmationRecord | null) {
  if (!confirmation) {
    return null;
  }

  return {
    id: confirmation.id,
    confirmedAt: confirmation.confirmedAt.toISOString(),
    version: confirmation.version,
    comment: confirmation.comment,
    isValid: confirmation.isValid,
  };
}

function buildStatusStats<T extends { status: ScheduleConfirmStatus }>(items: T[]) {
  const confirmed = items.filter((item) => item.status === 'CONFIRMED').length;
  const pending = items.filter((item) => item.status === 'PENDING').length;
  const needReconfirm = items.filter((item) => item.status === 'NEED_RECONFIRM').length;
  const expired = items.filter((item) => item.status === 'EXPIRED').length;
  const notReleased = items.filter((item) => item.status === 'NOT_RELEASED').length;
  const actionableTotal = items.length - notReleased;

  return {
    total: items.length,
    confirmed,
    pending,
    needReconfirm,
    expired,
    notReleased,
    progress: actionableTotal > 0 ? Math.round((confirmed / actionableTotal) * 100) : 0,
  };
}

function compareYearMonthDesc(left: string, right: string) {
  return right.localeCompare(left, 'zh-Hant');
}

function buildShiftCounts(schedules: Array<{ shiftType: string }>) {
  const counts = new Map<string, number>();

  for (const schedule of schedules) {
    counts.set(schedule.shiftType, (counts.get(schedule.shiftType) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([shiftType, count]) => ({ shiftType, count }))
    .sort((a, b) => a.shiftType.localeCompare(b.shiftType));
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/schedule-confirmation');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const rawYearMonth = searchParams.get('yearMonth');
    const department = searchParams.get('department');
    const employeeCode = searchParams.get('employeeId');
    const statusFilter = parseStatusFilter(searchParams.get('status'));

    if (searchParams.get('status') && !statusFilter) {
      return NextResponse.json({ error: 'status 參數格式錯誤' }, { status: 400 });
    }

    // 查詢員工自己的確認狀態
    if (type === 'my-status') {
      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, department: true }
      });

      if (!employee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
      }

      // 查詢發布記錄
      const releases = await prisma.scheduleMonthlyRelease.findMany({
        where: {
          yearMonth,
          OR: getScheduleReleaseDepartmentFilters(employee.department),
          status: 'PUBLISHED'
        },
        include: {
          publishedBy: { select: { name: true } },
          confirmations: {
            where: { employeeId: employee.id },
            take: 1
          }
        },
        orderBy: { publishedAt: 'desc' }
      });
      const release = pickApplicableScheduleRelease(releases as ScheduleMonthlyReleaseRecord[], employee.department);

      const confirmation = release?.confirmations?.[0] || null;
      const status = getConfirmStatus(release, confirmation);
      const scheduleConfirmSettings = await getScheduleConfirmSettings();

      // 查詢班表摘要
      let scheduleSummary = null;
      if (release) {
        const [schedules, shiftDefinitions] = await Promise.all([
          prisma.schedule.findMany({
            where: {
              employeeId: employee.id,
              workDate: {
                startsWith: yearMonth
              }
            }
          }),
          listShiftDefinitions({ includeInactive: true }),
        ]);

        const resolvedSchedules = schedules.map((schedule) => resolveScheduleHourFields({
          shiftType: schedule.shiftType,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          breakTime: schedule.breakTime,
          workHours: schedule.workHours,
          specialLeaveHours: schedule.specialLeaveHours,
          compLeaveHours: schedule.compLeaveHours,
          overtimeHours: schedule.overtimeHours,
        }, shiftDefinitions));

        const workDays = resolvedSchedules.filter((schedule) => schedule.workHours > 0).length;
        const restDays = resolvedSchedules.filter((schedule) => schedule.workHours <= 0).length;
        const shiftA = schedules.filter(s => s.shiftType === 'A').length;
        const shiftB = schedules.filter(s => s.shiftType === 'B').length;
        const shiftC = schedules.filter(s => s.shiftType === 'C').length;
        const shiftCounts = buildShiftCounts(schedules);

        scheduleSummary = {
          total: schedules.length,
          workDays,
          restDays,
          shiftA,
          shiftB,
          shiftC,
          shiftCounts
        };
      }

      return NextResponse.json({
        success: true,
        status,
        release: release ? {
          id: release.id,
          yearMonth: release.yearMonth,
          publishedAt: release.publishedAt.toISOString(),
          deadline: release.deadline?.toISOString(),
          version: release.version,
          lastModified: release.lastModified.toISOString(),
          publisherName: release.publishedBy.name
        } : null,
        confirmation: confirmation ? {
          id: confirmation.id,
          confirmedAt: confirmation.confirmedAt.toISOString(),
          version: confirmation.version,
          comment: confirmation.comment
        } : null,
        scheduleSummary,
        reminderEnabled: scheduleConfirmSettings.enabled && scheduleConfirmSettings.enableReminder,
        clockBlockingEnabled: scheduleConfirmSettings.enabled && scheduleConfirmSettings.blockClock,
      });
    }

    if (type === 'my-history') {
      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, department: true }
      });

      if (!employee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
      }

      if (rawYearMonth) {
        const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
        if (!yearMonthResult.isValid || yearMonthResult.value === null) {
          return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
        }
      }

      const yearMonthFilter = rawYearMonth || null;
      const scheduleMonths = await prisma.schedule.findMany({
        where: {
          employeeId: employee.id,
          ...(yearMonthFilter ? { workDate: { startsWith: yearMonthFilter } } : {}),
        },
        select: { workDate: true },
      });

      const releases = await prisma.scheduleMonthlyRelease.findMany({
        where: {
          status: 'PUBLISHED',
          OR: [
            { department: null },
            { department: SCHEDULE_ALL_DEPARTMENTS },
            { department: employee.department || '' }
          ],
          ...(yearMonthFilter ? { yearMonth: yearMonthFilter } : {}),
        },
        include: {
          publishedBy: { select: { name: true } }
        },
        orderBy: [
          { yearMonth: 'desc' },
          { publishedAt: 'desc' }
        ],
      });

      const confirmationWhere = {
        employeeId: employee.id,
        ...(yearMonthFilter ? { yearMonth: yearMonthFilter } : {}),
        ...(releases.length > 0 ? { releaseId: { in: releases.map((release) => release.id) } } : {}),
      };

      const confirmations = releases.length > 0
        ? await prisma.scheduleConfirmation.findMany({
            where: confirmationWhere,
            select: {
              id: true,
              employeeId: true,
              yearMonth: true,
              releaseId: true,
              version: true,
              confirmedAt: true,
              comment: true,
              isValid: true,
            },
          })
        : [];

      const releaseMapByMonth = groupReleasesByMonth(releases as ScheduleMonthlyReleaseRecord[]);
      const confirmationMap = new Map(confirmations.map((confirmation) => [confirmation.releaseId, confirmation]));
      const months = new Set<string>();

      if (yearMonthFilter) {
        months.add(yearMonthFilter);
      }

      releases.forEach((release) => {
        months.add(release.yearMonth);
      });
      scheduleMonths.forEach((schedule) => {
        months.add(schedule.workDate.slice(0, 7));
      });
      confirmations.forEach((confirmation) => {
        months.add(confirmation.yearMonth);
      });

      const items = Array.from(months)
        .sort(compareYearMonthDesc)
        .map((yearMonth) => {
          const applicableRelease = pickApplicableScheduleRelease(releaseMapByMonth.get(yearMonth) ?? [], employee.department);
          const confirmation = applicableRelease ? confirmationMap.get(applicableRelease.id) ?? null : null;
          const status = getConfirmStatus(applicableRelease, confirmation);

          return {
            yearMonth,
            status,
            release: serializeRelease(applicableRelease),
            confirmation: serializeConfirmation(confirmation),
          };
        })
        .filter((item) => (statusFilter ? item.status === statusFilter : true));

      return NextResponse.json({
        success: true,
        items,
        stats: buildStatusStats(items),
      });
    }

    if (type === 'admin-status-list') {
      if (!['ADMIN', 'HR'].includes(user.role)) {
        return NextResponse.json({ error: '無權限' }, { status: 403 });
      }

      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const employees = await prisma.employee.findMany({
        where: {
          isActive: true,
          ...(department ? { department } : {}),
          ...(employeeCode ? { employeeId: employeeCode } : {}),
        },
        select: {
          id: true,
          employeeId: true,
          name: true,
          department: true,
          position: true,
        },
        orderBy: [
          { department: 'asc' },
          { employeeId: 'asc' },
          { name: 'asc' },
        ],
      });

      if (employees.length === 0) {
        return NextResponse.json({
          success: true,
          employees: [],
          stats: buildStatusStats([]),
        });
      }

      const employeeDepartments = [...new Set(
        employees.map((employee) => employee.department).filter((value): value is string => Boolean(value))
      )];

      const [releases, scheduleRows] = await Promise.all([
        prisma.scheduleMonthlyRelease.findMany({
          where: {
            yearMonth,
            status: 'PUBLISHED',
            OR: [
              { department: null },
              { department: SCHEDULE_ALL_DEPARTMENTS },
              ...(employeeDepartments.length > 0 ? [{ department: { in: employeeDepartments } }] : []),
            ],
          },
          include: {
            publishedBy: { select: { name: true } }
          },
          orderBy: { publishedAt: 'desc' },
        }),
        prisma.schedule.findMany({
          where: {
            employeeId: { in: employees.map((employee) => employee.id) },
            workDate: { startsWith: `${yearMonth}-` },
          },
          select: {
            employeeId: true,
          },
        }),
      ]);

      const confirmations = releases.length > 0
        ? await prisma.scheduleConfirmation.findMany({
            where: {
              employeeId: { in: employees.map((employee) => employee.id) },
              releaseId: { in: releases.map((release) => release.id) },
            },
            select: {
              id: true,
              employeeId: true,
              yearMonth: true,
              releaseId: true,
              version: true,
              confirmedAt: true,
              comment: true,
              isValid: true,
            },
          })
        : [];

      const confirmationMap = new Map(
        confirmations.map((confirmation) => [`${confirmation.employeeId}:${confirmation.releaseId}`, confirmation])
      );
      const scheduleCountMap = scheduleRows.reduce<Map<number, number>>((result, schedule) => {
        result.set(schedule.employeeId, (result.get(schedule.employeeId) ?? 0) + 1);
        return result;
      }, new Map());

      const items = employees
        .map((employee) => {
          const applicableRelease = pickApplicableScheduleRelease(releases as ScheduleMonthlyReleaseRecord[], employee.department);
          const confirmation = applicableRelease
            ? confirmationMap.get(`${employee.id}:${applicableRelease.id}`) ?? null
            : null;
          const scheduleCount = scheduleCountMap.get(employee.id) ?? 0;
          const hasSchedules = scheduleCount > 0;
          const status = applicableRelease
            ? getConfirmStatus(applicableRelease, confirmation)
            : hasSchedules
              ? 'PENDING'
              : 'NOT_RELEASED';

          return {
            id: employee.id,
            employeeId: employee.employeeId,
            name: employee.name,
            department: employee.department,
            position: employee.position,
            yearMonth,
            status,
            release: serializeRelease(applicableRelease),
            confirmation: serializeConfirmation(confirmation),
            scheduleCount,
            hasSchedules,
          };
        })
        .filter((item) => (statusFilter ? item.status === statusFilter : true));

      return NextResponse.json({
        success: true,
        employees: items,
        stats: buildStatusStats(items),
      });
    }

    // 管理員查詢部門確認進度
    if (type === 'department-progress') {
      if (!['ADMIN', 'HR'].includes(user.role)) {
        return NextResponse.json({ error: '無權限' }, { status: 403 });
      }

      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      // 查詢發布記錄
      const release = await prisma.scheduleMonthlyRelease.findFirst({
        where: {
          yearMonth,
          OR: department
            ? [{ department }]
            : [{ department: null }, { department: SCHEDULE_ALL_DEPARTMENTS }]
        },
        include: {
          publishedBy: { select: { name: true } }
        }
      });

      if (!release) {
        return NextResponse.json({
          success: true,
          release: null,
          employees: [],
          stats: { total: 0, confirmed: 0, pending: 0 }
        });
      }

      // 查詢部門員工
      const employees = await prisma.employee.findMany({
        where: {
          isActive: true,
          ...(department ? { department } : {})
        },
        select: {
          id: true,
          employeeId: true,
          name: true,
          department: true
        }
      });

      // 查詢這些員工的確認記錄
      const confirmations = await prisma.scheduleConfirmation.findMany({
        where: {
          releaseId: release.id,
          employeeId: { in: employees.map(e => e.id) }
        }
      });

      const confirmMap = new Map(confirmations.map(c => [c.employeeId, c]));

      const employeeList = employees.map(emp => {
        const conf = confirmMap.get(emp.id);
        const empStatus = getConfirmStatus(release, conf || null);
        
        return {
          id: emp.id,
          employeeId: emp.employeeId,
          name: emp.name,
          department: emp.department,
          status: empStatus,
          confirmedAt: conf?.confirmedAt?.toISOString() || null,
          version: conf?.version || null
        };
      });

      const confirmed = employeeList.filter(e => e.status === 'CONFIRMED').length;
      const pending = employeeList.filter(e => ['PENDING', 'NEED_RECONFIRM', 'EXPIRED'].includes(e.status)).length;

      return NextResponse.json({
        success: true,
        release: {
          id: release.id,
          yearMonth: release.yearMonth,
          publishedAt: release.publishedAt.toISOString(),
          deadline: release.deadline?.toISOString(),
          version: release.version,
          publisherName: release.publishedBy.name
        },
        employees: employeeList,
        stats: {
          total: employeeList.length,
          confirmed,
          pending,
          progress: employeeList.length > 0 ? Math.round((confirmed / employeeList.length) * 100) : 0
        }
      });
    }

    return NextResponse.json({ error: '無效的 type 參數' }, { status: 400 });

  } catch (error) {
    console.error('班表確認查詢錯誤:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/schedule-confirmation');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的班表確認資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的班表確認資料' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action : '';
    const department = typeof body.department === 'string' ? body.department : '';
    const comment = typeof body.comment === 'string' ? body.comment : undefined;
    const rawYearMonth = typeof body.yearMonth === 'string' ? body.yearMonth : null;
    const confirmRepublish = body.confirmRepublish === true;

    if (body.confirmRepublish !== undefined && typeof body.confirmRepublish !== 'boolean') {
      return NextResponse.json({ error: 'confirmRepublish 必須是布林值' }, { status: 400 });
    }

    // 員工確認班表
    if (action === 'confirm') {
      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const confirmRateLimitResult = await checkRateLimit(request, '/api/schedule-confirmation/confirm');
      if (!confirmRateLimitResult.allowed) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }

      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, department: true }
      });

      if (!employee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
      }
      
      // 密碼驗證
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password) {
        return NextResponse.json({ error: '請輸入密碼以驗證身份' }, { status: 400 });
      }

      // 取得用戶密碼
      const userRecord = await prisma.user.findFirst({
        where: { employeeId: employee.id },
        select: { passwordHash: true }
      });

      if (!userRecord) {
        return NextResponse.json({ error: '找不到用戶資料' }, { status: 400 });
      }

      // 驗證密碼
      const bcrypt = await import('bcryptjs');
      const isPasswordValid = await bcrypt.compare(password, userRecord.passwordHash);
      
      if (!isPasswordValid) {
        return NextResponse.json({ error: '密碼錯誤，請重新輸入' }, { status: 401 });
      }

      // 查詢已正式發布的記錄
      const releases = await prisma.scheduleMonthlyRelease.findMany({
        where: {
          yearMonth,
          status: 'PUBLISHED',
          OR: getScheduleReleaseDepartmentFilters(employee.department),
        },
        orderBy: { publishedAt: 'desc' }
      });
      const release = pickApplicableScheduleRelease(releases, employee.department);

      if (!release) {
        return NextResponse.json({ error: '本月班表尚未發布，無法確認' }, { status: 409 });
      }

      // 建立或更新確認記錄
      const confirmation = await prisma.scheduleConfirmation.upsert({
        where: {
          employeeId_releaseId: {
            employeeId: employee.id,
            releaseId: release.id
          }
        },
        create: {
          employeeId: employee.id,
          yearMonth,
          releaseId: release.id,
          version: release.version,
          confirmedAt: new Date(),
          comment,
          isValid: true
        },
        update: {
          version: release.version,
          confirmedAt: new Date(),
          comment,
          isValid: true
        }
      });

      return NextResponse.json({
        success: true,
        message: '班表確認成功',
        confirmation: {
          id: confirmation.id,
          confirmedAt: confirmation.confirmedAt.toISOString(),
          version: confirmation.version
        }
      });
    }

    // 主管/管理員發布班表
    if (action === 'publish') {
      if (!['ADMIN', 'HR'].includes(user.role)) {
        return NextResponse.json({ error: '無權限發布班表' }, { status: 403 });
      }

      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, department: true }
      });

      if (!employee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
      }

      const deadline = getLastDayOfMonth(yearMonth);

      const targetDepartment = department || SCHEDULE_ALL_DEPARTMENTS;

      const existingRelease = await prisma.scheduleMonthlyRelease.findFirst({
        where: {
          yearMonth,
          ...(department
            ? { department: targetDepartment }
            : { OR: [{ department: null }, { department: SCHEDULE_ALL_DEPARTMENTS }] })
        }
      });

      if (existingRelease && !confirmRepublish) {
        const confirmedCount = await prisma.scheduleConfirmation.count({
          where: { releaseId: existingRelease.id, isValid: true },
        });
        if (confirmedCount > 0) {
          return NextResponse.json({
            error: `重新發布將使 ${confirmedCount} 筆已確認班表失效`,
            requiresRepublishConfirmation: true,
            confirmedCount,
          }, { status: 409 });
        }
      }

      const release = existingRelease
        ? await prisma.scheduleMonthlyRelease.update({
            where: { id: existingRelease.id },
            data: {
              publishedById: employee.id,
              publishedAt: new Date(),
              deadline,
              status: 'PUBLISHED',
              version: { increment: 1 },
              lastModified: new Date()
            }
          })
        : await prisma.scheduleMonthlyRelease.upsert({
            where: {
              yearMonth_department: { yearMonth, department: targetDepartment }
            },
            update: {
              publishedById: employee.id,
              publishedAt: new Date(),
              deadline,
              status: 'PUBLISHED',
              version: { increment: 1 },
              lastModified: new Date()
            },
            create: {
              yearMonth,
              department: targetDepartment,
              publishedById: employee.id,
              publishedAt: new Date(),
              deadline,
              status: 'PUBLISHED',
              version: 1
            }
          });

      // 如果版本更新，將所有確認標記為無效
      if (release.version > 1) {
        await prisma.scheduleConfirmation.updateMany({
          where: { releaseId: release.id },
          data: { isValid: false }
        });
      }

      // 發送通知給該月有班表的相關員工
      const monthRange = getMonthDateRange(yearMonth);
      const schedulesToNotify = await prisma.schedule.findMany({
        where: {
          workDate: {
            gte: monthRange.start,
            lte: monthRange.end,
          },
          employee: {
            is: {
              isActive: true,
              ...(department ? { department } : {})
            }
          }
        },
        select: { employeeId: true }
      });
      const employeeIdsToNotify = Array.from(new Set(schedulesToNotify.map((schedule) => schedule.employeeId)));

      const notifyResult = await sendSchedulePublishNotification(
        yearMonth,
        employeeIdsToNotify,
        deadline
      );

      return NextResponse.json({
        success: true,
        message: '班表發布成功',
        release: {
          id: release.id,
          yearMonth: release.yearMonth,
          version: release.version,
          deadline: release.deadline?.toISOString()
        },
        notification: notifyResult
      });
    }

    // 發送提醒給未確認的員工
    if (action === 'send-reminder') {
      if (!['ADMIN', 'HR'].includes(user.role)) {
        return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
      }

      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const reminderResult = await sendReminderToUnconfirmed(yearMonth, department || undefined);

      return NextResponse.json({
        success: true,
        message: `已發送${reminderResult.sent}則提醒通知`,
        ...reminderResult
      });
    }

    return NextResponse.json({ error: '無效的 action 參數' }, { status: 400 });

  } catch (error) {
    console.error('班表確認操作錯誤:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}
