import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || (decoded.role !== 'ADMIN' && decoded.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { sourceType, sourceDate, targetDate, employeeIds, overwrite } = body;

    // 兼容舊版 API（fromYear, fromMonth, toYear, toMonth）
    if (body.fromYear && body.fromMonth && body.toYear && body.toMonth) {
      const { fromYear, fromMonth, toYear, toMonth } = body;
      
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
              endTime: schedule.endTime
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
    if (!sourceType || !['week', 'month'].includes(sourceType)) {
      return NextResponse.json({ error: '請指定複製類型（week 或 month）' }, { status: 400 });
    }

    if (!sourceDate || !targetDate) {
      return NextResponse.json({ error: '請指定來源日期和目標日期' }, { status: 400 });
    }

    let sourceStart: Date;
    let sourceEnd: Date;
    let targetStart: Date;
    let daysDiff: number;

    if (sourceType === 'week') {
      sourceStart = new Date(sourceDate);
      sourceStart.setDate(sourceStart.getDate() - sourceStart.getDay());
      sourceEnd = new Date(sourceStart);
      sourceEnd.setDate(sourceEnd.getDate() + 6);
      
      targetStart = new Date(targetDate);
      targetStart.setDate(targetStart.getDate() - targetStart.getDay());
      
      daysDiff = Math.round((targetStart.getTime() - sourceStart.getTime()) / (1000 * 60 * 60 * 24));
    } else {
      sourceStart = new Date(sourceDate);
      sourceStart.setDate(1);
      sourceEnd = new Date(sourceStart.getFullYear(), sourceStart.getMonth() + 1, 0);
      
      targetStart = new Date(targetDate);
      targetStart.setDate(1);
      
      daysDiff = Math.round((targetStart.getTime() - sourceStart.getTime()) / (1000 * 60 * 60 * 24));
    }

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const whereClause: {
      workDate: { gte: string; lte: string };
      employeeId?: { in: number[] };
    } = {
      workDate: {
        gte: formatDate(sourceStart),
        lte: formatDate(sourceEnd)
      }
    };

    if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
      whereClause.employeeId = { in: employeeIds.map((id: number | string) => parseInt(String(id))) };
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
              endTime: schedule.endTime
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
            endTime: schedule.endTime
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
