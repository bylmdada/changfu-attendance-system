import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

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

    if (parsedYear !== null && parsedMonth !== null) {
      const startOfMonth = `${parsedYear}-${parsedMonth.toString().padStart(2, '0')}-01`;
      const endOfMonth = `${parsedYear}-${parsedMonth.toString().padStart(2, '0')}-31`;
      where.workDate = {
        gte: startOfMonth,
        lte: endOfMonth
      };
    } else if (startDate && endDate) {
      where.workDate = {
        gte: startDate,
        lte: endDate
      };
    }

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
      orderBy: {
        workDate: 'asc'
      }
    });

    const formattedSchedules = schedules.map(schedule => ({
      id: schedule.id,
      employeeId: schedule.employeeId,
      workDate: schedule.workDate,
      shiftType: schedule.shiftType,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      employee: schedule.employee
    }));

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
