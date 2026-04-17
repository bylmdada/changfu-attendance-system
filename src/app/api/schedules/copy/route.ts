import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// POST - 快速複製班表（複製上週/上月班表到指定週/月）
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded || (decoded.role !== 'ADMIN' && decoded.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請指定複製類型（week 或 month）' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請指定複製類型（week 或 month）' }, { status: 400 });
    }

    const { sourceType, sourceDate, targetDate, employeeIds, overwrite } = body;
    const sourceTypeValue = typeof sourceType === 'string' ? sourceType : null;
    const sourceDateValue = typeof sourceDate === 'string' ? sourceDate : null;
    const targetDateValue = typeof targetDate === 'string' ? targetDate : null;

    // 兼容舊版 API（fromYear, fromMonth, toYear, toMonth）
    if (body.fromYear && body.fromMonth && body.toYear && body.toMonth) {
      const fromYearResult = parseIntegerQueryParam(String(body.fromYear), { min: 1, max: 99999999 });
      const fromMonthResult = parseIntegerQueryParam(String(body.fromMonth), { min: 1, max: 12 });
      const toYearResult = parseIntegerQueryParam(String(body.toYear), { min: 1, max: 99999999 });
      const toMonthResult = parseIntegerQueryParam(String(body.toMonth), { min: 1, max: 12 });

      if (!fromYearResult.isValid || fromYearResult.value === null ||
          !fromMonthResult.isValid || fromMonthResult.value === null ||
          !toYearResult.isValid || toYearResult.value === null ||
          !toMonthResult.isValid || toMonthResult.value === null) {
        return NextResponse.json({ error: '舊版複製參數格式錯誤' }, { status: 400 });
      }

      const fromYear = fromYearResult.value;
      const fromMonth = fromMonthResult.value;
      const toYear = toYearResult.value;
      const toMonth = toMonthResult.value;
      
      const sourceStart = new Date(fromYear, fromMonth - 1, 1);
      const sourceEnd = new Date(fromYear, fromMonth, 0);
      const targetStart = new Date(toYear, toMonth - 1, 1);
      
      const formatDate = (date: Date) => date.toISOString().split('T')[0];
      const daysDiff = Math.round((targetStart.getTime() - sourceStart.getTime()) / (1000 * 60 * 60 * 24));

      const sourceSchedules = await prisma.schedule.findMany({
        where: {
          workDate: {
            gte: formatDate(sourceStart),
            lte: formatDate(sourceEnd)
          }
        }
      });

      if (sourceSchedules.length === 0) {
        return NextResponse.json({ error: '來源月份沒有班表記錄' }, { status: 400 });
      }

      let createdCount = 0;

      for (const schedule of sourceSchedules) {
        const sourceWorkDate = new Date(schedule.workDate);
        const targetWorkDate = new Date(sourceWorkDate);
        targetWorkDate.setDate(targetWorkDate.getDate() + daysDiff);
        const targetWorkDateStr = formatDate(targetWorkDate);

        const existing = await prisma.schedule.findFirst({
          where: {
            employeeId: schedule.employeeId,
            workDate: targetWorkDateStr
          }
        });

        if (!existing) {
          await prisma.schedule.create({
            data: {
              employeeId: schedule.employeeId,
              workDate: targetWorkDateStr,
              shiftType: schedule.shiftType,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
              breakTime: schedule.breakTime
            }
          });
          createdCount++;
        }
      }

      return NextResponse.json({ 
        message: '班表複製成功',
        details: {
          from: `${fromYear}年${fromMonth}月`,
          to: `${toYear}年${toMonth}月`,
          copiedCount: createdCount
        }
      });
    }

    // 新版 API 邏輯
    if (!sourceTypeValue || !['week', 'month'].includes(sourceTypeValue)) {
      return NextResponse.json({ error: '請指定複製類型（week 或 month）' }, { status: 400 });
    }

    if (!sourceDateValue || !targetDateValue) {
      return NextResponse.json({ error: '請指定來源日期和目標日期' }, { status: 400 });
    }

    let sourceStart: Date;
    let sourceEnd: Date;
    let targetStart: Date;
    let daysDiff: number;

    if (sourceTypeValue === 'week') {
      sourceStart = new Date(sourceDateValue);
      sourceStart.setDate(sourceStart.getDate() - sourceStart.getDay());
      sourceEnd = new Date(sourceStart);
      sourceEnd.setDate(sourceEnd.getDate() + 6);
      
      targetStart = new Date(targetDateValue);
      targetStart.setDate(targetStart.getDate() - targetStart.getDay());
      
      daysDiff = Math.round((targetStart.getTime() - sourceStart.getTime()) / (1000 * 60 * 60 * 24));
    } else {
      sourceStart = new Date(sourceDateValue);
      sourceStart.setDate(1);
      sourceEnd = new Date(sourceStart.getFullYear(), sourceStart.getMonth() + 1, 0);
      
      targetStart = new Date(targetDateValue);
      targetStart.setDate(1);
      
      daysDiff = Math.round((targetStart.getTime() - sourceStart.getTime()) / (1000 * 60 * 60 * 24));
    }

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    let normalizedEmployeeIds: number[] | undefined;
    if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
      normalizedEmployeeIds = employeeIds.map((id: number | string) => {
        const result = parseIntegerQueryParam(String(id), { min: 1, max: 99999999 });
        return result.isValid ? result.value : null;
      }).filter((id): id is number => id !== null);

      if (normalizedEmployeeIds.length !== employeeIds.length) {
        return NextResponse.json({ error: 'employeeIds 格式錯誤' }, { status: 400 });
      }
    }

    const whereClause: {
      workDate: { gte: string; lte: string };
      employeeId?: { in: number[] };
    } = {
      workDate: {
        gte: formatDate(sourceStart),
        lte: formatDate(sourceEnd)
      }
    };

    if (normalizedEmployeeIds && normalizedEmployeeIds.length > 0) {
      whereClause.employeeId = { in: normalizedEmployeeIds };
    }

    const sourceSchedules = await prisma.schedule.findMany({
      where: whereClause
    });

    if (sourceSchedules.length === 0) {
      return NextResponse.json({ error: '來源期間沒有班表記錄' }, { status: 400 });
    }

    let createdCount = 0;
    let skippedCount = 0;

    for (const schedule of sourceSchedules) {
      const sourceWorkDate = new Date(schedule.workDate);
      const targetWorkDate = new Date(sourceWorkDate);
      targetWorkDate.setDate(targetWorkDate.getDate() + daysDiff);
      const targetWorkDateStr = formatDate(targetWorkDate);

      const existing = await prisma.schedule.findFirst({
        where: {
          employeeId: schedule.employeeId,
          workDate: targetWorkDateStr
        }
      });

      if (existing) {
        if (overwrite) {
          await prisma.schedule.update({
            where: { id: existing.id },
            data: {
              shiftType: schedule.shiftType,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
              breakTime: schedule.breakTime
            }
          });
          createdCount++;
        } else {
          skippedCount++;
        }
      } else {
        await prisma.schedule.create({
          data: {
            employeeId: schedule.employeeId,
            workDate: targetWorkDateStr,
            shiftType: schedule.shiftType,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            breakTime: schedule.breakTime
          }
        });
        createdCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `班表複製完成`,
      details: {
        sourceRange: `${formatDate(sourceStart)} ~ ${formatDate(sourceEnd)}`,
        targetRange: `${formatDate(targetStart)} ~ ${formatDate(new Date(targetStart.getTime() + (sourceEnd.getTime() - sourceStart.getTime())))}`,
        created: createdCount,
        skipped: skippedCount,
        total: sourceSchedules.length
      }
    });
  } catch (error) {
    console.error('複製班表失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
