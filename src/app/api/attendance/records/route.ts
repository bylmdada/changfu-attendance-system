import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/database';
import { parseIntegerQueryParam } from '@/lib/query-params';

function parseDateQueryParam(rawValue: string | null) {
  if (rawValue === null || rawValue === '') {
    return {
      value: null,
      isValid: true,
    };
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) {
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

  if (requestedStatus === '缺勤') {
    return displayStatus === '缺勤';
  }

  return false;
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
    const search = searchParams.get('search');
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

    const allowedStatuses = new Set(['正常', '異常', '遲到', '早退', '缺勤']);
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
      search,
      status,
      overtimeHours
    });

    // 構建查詢條件
    const where: Record<string, unknown> = {};
    
    // 非管理員只能查看自己的記錄
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      where.employeeId = user.employeeId;
    } else {
      // 管理員可以搜尋和篩選
      const employeeConditions: Record<string, unknown>[] = [];
      
      // 搜尋條件
      if (search) {
        employeeConditions.push({
          OR: [
            { name: { contains: search } },
            { employeeId: { contains: search } }
          ]
        });
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
      where.workDate = {};
      if (parsedStartDate.value) {
        (where.workDate as Record<string, unknown>).gte = parsedStartDate.value;
      }
      if (parsedEndDate.value) {
        const end = new Date(parsedEndDate.value);
        end.setHours(23, 59, 59, 999);
        (where.workDate as Record<string, unknown>).lte = end;
      }
    }

    // 加班工時篩選
    if (overtimeHours) {
      if (overtimeHours === '0') {
        where.overtimeHours = 0;
      } else if (overtimeHours === '>0') {
        where.overtimeHours = { gt: 0 };
      } else if (overtimeHours === '>2') {
        where.overtimeHours = { gt: 2 };
      } else if (overtimeHours === '>4') {
        where.overtimeHours = { gt: 4 };
      }
    }

    const shouldFilterByDisplayStatus = !!status;

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

    if (shouldFilterByDisplayStatus) {
      records = await prisma.attendanceRecord.findMany(recordQuery);
    } else {
      total = await prisma.attendanceRecord.count({ where });
      records = await prisma.attendanceRecord.findMany({
        ...recordQuery,
        skip: (page - 1) * pageSize,
        take: pageSize
      });
    }

    // 獲取相關的班表資料
    const workDates = records.map(r => r.workDate.toISOString().split('T')[0]);
    const employeeIds = [...new Set(records.map(r => r.employeeId))];
    
    const schedules = await prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: { in: workDates }
      }
    });

    // 建立班表查詢 Map
    const scheduleMap = new Map<string, { startTime: string; endTime: string }>();
    schedules.forEach(s => {
      const key = `${s.employeeId}-${s.workDate}`;
      scheduleMap.set(key, { startTime: s.startTime, endTime: s.endTime });
    });

    // 最低工時門檻（小時）
    const MIN_WORK_HOURS = 8;

    // 判斷遲到/早退的輔助函數
    const checkLateOrEarly = (
      clockIn: Date | null,
      clockOut: Date | null,
      scheduleStart: string | undefined,
      scheduleEnd: string | undefined
    ): { isLate: boolean; isEarly: boolean } => {
      let isLate = false;
      let isEarly = false;

      if (!scheduleStart || !scheduleEnd) {
        return { isLate, isEarly };
      }

      // 解析班表時間（格式：HH:mm 或 HH:mm:ss）
      const [startHour, startMin] = scheduleStart.split(':').map(Number);
      const [endHour, endMin] = scheduleEnd.split(':').map(Number);

      if (clockIn) {
        const clockInHour = clockIn.getHours();
        const clockInMin = clockIn.getMinutes();
        // 上班打卡時間超過班表開始時間 = 遲到
        if (clockInHour > startHour || (clockInHour === startHour && clockInMin > startMin)) {
          isLate = true;
        }
      }

      if (clockOut) {
        const clockOutHour = clockOut.getHours();
        const clockOutMin = clockOut.getMinutes();
        // 下班打卡時間早於班表結束時間 = 早退
        if (clockOutHour < endHour || (clockOutHour === endHour && clockOutMin < endMin)) {
          isEarly = true;
        }
      }

      return { isLate, isEarly };
    };

    // 格式化記錄
    const formattedRecords = records.map(record => {
      const workDateStr = record.workDate.toISOString().split('T')[0];
      const scheduleKey = `${record.employeeId}-${workDateStr}`;
      const schedule = scheduleMap.get(scheduleKey);
      
      // 判斷狀態
      let displayStatus: string;
      const totalHours = (record.regularHours || 0) + (record.overtimeHours || 0);
      const hasClockIn = !!record.clockInTime;
      const hasClockOut = !!record.clockOutTime;
      const hasSchedule = !!schedule;
      
      if (!hasClockIn && !hasClockOut) {
        // 完全沒有打卡記錄
        if (hasSchedule) {
          // 有班表但無任何打卡 = 缺勤
          displayStatus = '缺勤';
        } else {
          // 無班表也無打卡 = 異常（不應該有這種記錄）
          displayStatus = '異常';
        }
      } else if (!hasClockIn || !hasClockOut) {
        // 只有部分打卡（有上班沒下班，或有下班沒上班）= 異常
        displayStatus = '異常';
      } else if (totalHours < MIN_WORK_HOURS) {
        // 工時不足 8 小時
        displayStatus = '異常';
      } else {
        // 有完整打卡，檢查遲到/早退
        const { isLate, isEarly } = checkLateOrEarly(
          record.clockInTime,
          record.clockOutTime,
          schedule?.startTime,
          schedule?.endTime
        );

        if (isLate && isEarly) {
          displayStatus = '遲到+早退';
        } else if (isLate) {
          displayStatus = '遲到';
        } else if (isEarly) {
          displayStatus = '早退';
        } else {
          displayStatus = '正常';
        }
      }
      
      // 判斷是否為管理員/HR（可查看GPS資訊）
      const isAdmin = user.role === 'ADMIN' || user.role === 'HR';
      
      return {
        id: record.id,
        employeeId: record.employeeId,
        workDate: record.workDate.toISOString(),
        clockInTime: record.clockInTime?.toISOString() || null,
        clockOutTime: record.clockOutTime?.toISOString() || null,
        regularHours: record.regularHours || 0,
        overtimeHours: record.overtimeHours || 0,
        status: displayStatus,
        createdAt: record.createdAt.toISOString(),
        employee: record.employee,
        // 新增：班表資訊
        scheduledStart: schedule?.startTime || null,
        scheduledEnd: schedule?.endTime || null,
        // 新增：GPS 資訊（僅管理員/HR 可查看）
        ...(isAdmin ? {
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
    if (status) {
      finalRecords = formattedRecords.filter(r => matchesRequestedStatus(r.status, status));
      total = finalRecords.length;
      finalRecords = finalRecords.slice((page - 1) * pageSize, page * pageSize);
    }

    const summarySource = status
      ? formattedRecords.filter(r => matchesRequestedStatus(r.status, status))
      : await prisma.attendanceRecord.findMany({
          where,
          select: { regularHours: true, overtimeHours: true }
        });

    const totalRegularHours = summarySource.reduce((sum, r) => sum + (r.regularHours || 0), 0);
    const totalOvertimeHours = summarySource.reduce((sum, r) => sum + (r.overtimeHours || 0), 0);

    console.log(`✅ 返回考勤記錄: ${finalRecords.length} 筆 (總共 ${total} 筆)`);

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
        totalOvertimeHours: Math.round(totalOvertimeHours * 100) / 100
      }
    });
  
  } catch (error) {
    console.error('獲取考勤記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
