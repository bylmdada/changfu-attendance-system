import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { listShiftDefinitions } from '@/lib/shift-definition-service';
import { resolveScheduleHourFields } from '@/lib/shift-definition-utils';
import { toTaiwanDateStr } from '@/lib/timezone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseNumericQueryParam(value: string | null, name: string): number | null {
  if (value === null) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} 參數格式無效`);
  }

  return Number(value);
}

function roundHours(hours: number) {
  return Math.round(hours * 100) / 100;
}

function calculateExpectedWorkHours(schedule: {
  workHours: number | null;
  specialLeaveHours: number | null;
  compLeaveHours: number | null;
}) {
  return roundHours(
    (schedule.workHours ?? 0) +
    (schedule.specialLeaveHours ?? 0) +
    (schedule.compLeaveHours ?? 0)
  );
}

function toUtcDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    let parsedYear: number | null;
    let parsedMonth: number | null;

    try {
      parsedYear = parseNumericQueryParam(year, 'year');
      parsedMonth = parseNumericQueryParam(month, 'month');
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ error: '查詢參數格式無效' }, { status: 400 });
    }

    if (parsedMonth !== null && (parsedMonth < 1 || parsedMonth > 12)) {
      return NextResponse.json({ error: 'month 參數格式無效' }, { status: 400 });
    }

    const where: {
      employeeId: number;
      workDate?: {
        gte?: string;
        lte?: string;
      };
    } = {
      employeeId: user.employeeId
    };

    let effectiveStartDate: string | null = null;
    let effectiveEndDate: string | null = null;

    if (parsedYear !== null && parsedMonth !== null) {
      const startOfMonth = `${parsedYear}-${parsedMonth.toString().padStart(2, '0')}-01`;
      const lastDay = new Date(parsedYear, parsedMonth, 0).getDate();
      const endOfMonth = `${parsedYear}-${parsedMonth.toString().padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      effectiveStartDate = startOfMonth;
      effectiveEndDate = endOfMonth;
      where.workDate = {
        gte: startOfMonth,
        lte: endOfMonth
      };
    } else if (startDate && endDate) {
      effectiveStartDate = startDate;
      effectiveEndDate = endDate;
      where.workDate = {
        gte: startDate,
        lte: endDate
      };
    }

    const [schedules, shiftDefinitions, holidays] = await Promise.all([
      prisma.schedule.findMany({
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
        orderBy: {
          workDate: 'asc'
        }
      }),
      listShiftDefinitions({ includeInactive: true }),
      effectiveStartDate && effectiveEndDate
        ? prisma.holiday.findMany({
            where: {
              isActive: true,
              date: {
                gte: toUtcDate(effectiveStartDate),
                lte: toUtcDate(effectiveEndDate),
              },
            },
            select: {
              date: true,
              name: true,
            },
          })
        : Promise.resolve([]),
    ] as const);

    const holidayByDate = new Map(holidays.map(holiday => [toTaiwanDateStr(holiday.date), holiday.name]));

    const formattedSchedules = schedules.map(schedule => {
      const resolvedSchedule = resolveScheduleHourFields({
        shiftType: schedule.shiftType,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        breakTime: schedule.breakTime,
        workHours: schedule.workHours,
        specialLeaveHours: schedule.specialLeaveHours,
        compLeaveHours: schedule.compLeaveHours,
        overtimeHours: schedule.overtimeHours,
      }, shiftDefinitions);

      return {
        id: schedule.id,
        employeeId: schedule.employeeId,
        workDate: schedule.workDate,
        shiftType: resolvedSchedule.shiftType,
        startTime: resolvedSchedule.startTime,
        endTime: resolvedSchedule.endTime,
        breakTime: resolvedSchedule.breakTime,
        workHours: resolvedSchedule.workHours,
        expectedWorkHours: calculateExpectedWorkHours(resolvedSchedule),
        specialLeaveHours: resolvedSchedule.specialLeaveHours,
        compLeaveHours: resolvedSchedule.compLeaveHours,
        overtimeHours: resolvedSchedule.overtimeHours,
        isNationalHoliday: holidayByDate.has(schedule.workDate),
        nationalHolidayName: holidayByDate.get(schedule.workDate) || null,
        nationalHolidayHours: holidayByDate.has(schedule.workDate) ? roundHours(resolvedSchedule.workHours) : 0,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
        employee: schedule.employee,
      };
    });

    return NextResponse.json({
      success: true,
      schedules: formattedSchedules,
      total: formattedSchedules.length
    });
  } catch (error) {
    console.error('個人班表查詢錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
