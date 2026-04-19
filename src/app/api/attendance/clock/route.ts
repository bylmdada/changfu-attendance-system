import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { canEmployeeClockIn } from '@/lib/schedule-confirm-service';
import { isMobileClockingDevice, MOBILE_CLOCKING_REQUIRED_MESSAGE } from '@/lib/device-detection';
import { getActiveAllowedLocations, getGPSSettingsFromDB, isClockLocationPayload, validateGpsClockLocation } from '@/lib/gps-attendance';
import { getTaiwanTodayEnd, getTaiwanTodayStart, toTaiwanDateStr } from '@/lib/timezone';
import { safeParseJSON } from '@/lib/validation';
import { calculateAttendanceHours } from '@/lib/work-hours';
import {
  buildClockReasonPromptData,
  formatMinutesAsTime,
  parseClockReasonPromptSettings,
  shouldSkipClockReasonPrompt,
} from '@/lib/clock-reason-prompt-settings';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// GET - 獲取今日打卡狀態
export async function GET(request: NextRequest) {
  try {
    // 使用統一的身份驗證方式
    const userAuth = await getUserFromRequest(request);
    
    if (!userAuth) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const userId = userAuth.userId;

    // 獲取用戶的員工資料
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: true }
    });

    if (!user || !user.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    // 獲取今日日期（使用台灣時區）
    const now = new Date();
    const todayStart = getTaiwanTodayStart(now);
    const todayEnd = getTaiwanTodayEnd(now);

    // 查找今日考勤記錄
    const todayAttendance = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: {
          gte: todayStart,
          lt: todayEnd
        }
      }
    });

    const result = {
      hasClockIn: todayAttendance?.clockInTime != null,
      hasClockOut: todayAttendance?.clockOutTime != null,
      today: todayAttendance
    };
    return NextResponse.json(result);

  } catch (error) {
    console.error('Failed to fetch attendance clock status', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 智能打卡
export async function POST(request: NextRequest) {
  try {
    if (!isMobileClockingDevice(request.headers.get('user-agent'))) {
      return NextResponse.json({ error: MOBILE_CLOCKING_REQUIRED_MESSAGE }, { status: 403 });
    }

    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/attendance/clock');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '打卡操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '無效的打卡類型' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '無效的打卡類型' }, { status: 400 });
    }

    const type = typeof body.type === 'string' ? body.type : null;

    if (body.location !== undefined && body.location !== null && !isClockLocationPayload(body.location)) {
      return NextResponse.json({ error: 'GPS定位資料格式錯誤' }, { status: 400 });
    }

    const location = body.location === undefined || body.location === null ? null : body.location;

    if (!type || !['in', 'out'].includes(type)) {
      return NextResponse.json({ error: '無效的打卡類型' }, { status: 400 });
    }

    // 使用統一的身份驗證方式
    const userAuth = await getUserFromRequest(request);
    
    if (!userAuth) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const userId = userAuth.userId;

    // 獲取用戶的員工資料
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: true }
    });

    if (!user || !user.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    const gpsSettings = await getGPSSettingsFromDB();
    const allowedLocations = gpsSettings.enabled ? await getActiveAllowedLocations() : [];
    const gpsValidation = validateGpsClockLocation({
      gpsSettings,
      location,
      allowedLocations,
    });

    if (!gpsValidation.ok) {
      console.warn('Attendance clock GPS validation rejected', {
        userId,
        code: gpsValidation.code,
        accuracy: location?.accuracy ?? null,
        nearestLocation: gpsValidation.nearestLocation ?? null,
        nearestDistance: gpsValidation.nearestDistance ?? null,
      });

      return NextResponse.json(
        {
          error: gpsValidation.error,
          code: gpsValidation.code,
        },
        { status: 400 }
      );
    }

    // 班表確認檢查：員工必須已確認當月班表才能打卡
    const clockCheck = await canEmployeeClockIn(user.employee.id, new Date());
    if (!clockCheck.allowed) {
      return NextResponse.json({ 
        error: clockCheck.reason || '無法打卡',
        code: 'SCHEDULE_NOT_CONFIRMED'
      }, { status: 403 });
    }

    // 獲取今日日期和當前時間（使用台灣時區）
    const now = new Date();
    const todayStart = getTaiwanTodayStart(now);
    const todayEnd = getTaiwanTodayEnd(now);
    const currentTime = now.toISOString();

    // 獲取今日已有的考勤記錄
    const existingAttendance = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: {
          gte: todayStart,
          lt: todayEnd
        }
      }
    });

    const todayStr = toTaiwanDateStr(now);
    const todaySchedule = await prisma.schedule.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: todayStr
      }
    });
    const reasonPromptSetting = await prisma.systemSettings.findUnique({
      where: { key: 'clock_reason_prompt' }
    });
    const reasonPromptSettings = parseClockReasonPromptSettings(reasonPromptSetting?.value);
    const taiwanNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const currentTaiwanTime = formatMinutesAsTime(taiwanNow.getHours() * 60 + taiwanNow.getMinutes());

    let isHoliday = false;
    let hasApprovedOvertime = false;

    if (reasonPromptSettings.enabled && reasonPromptSettings.excludeHolidays) {
      const holiday = await prisma.holiday.findFirst({
        where: {
          date: {
            gte: todayStart,
            lt: todayEnd
          },
          isActive: true
        }
      });
      isHoliday = Boolean(holiday);
    }

    if (reasonPromptSettings.enabled && reasonPromptSettings.excludeApprovedOvertime) {
      const approvedOvertime = await prisma.overtimeRequest.findFirst({
        where: {
          employeeId: user.employee.id,
          overtimeDate: {
            gte: todayStart,
            lt: todayEnd
          },
          status: 'APPROVED'
        }
      });
      hasApprovedOvertime = Boolean(approvedOvertime);
    }

    const skipReasonPrompt = shouldSkipClockReasonPrompt({
      settings: reasonPromptSettings,
      isHoliday,
      isRestDay: todaySchedule?.shiftType === 'OFF',
      hasApprovedOvertime,
    });

    if (type === 'in') {
      // 上班打卡
      // 檢查是否已經打過上班卡
      if (existingAttendance?.clockInTime) {
        return NextResponse.json({ error: '今日已打過上班卡' }, { status: 400 });
      }

      // 創建或更新考勤記錄
      const attendance = await prisma.attendanceRecord.upsert({
        where: {
          employeeId_workDate: {
            employeeId: user.employee.id,
            workDate: todayStart
          }
        },
        update: {
          clockInTime: currentTime,
          status: 'PRESENT',
          // 新增GPS位置資訊
          ...(location && {
            clockInLatitude: location.latitude,
            clockInLongitude: location.longitude,
            clockInAccuracy: location.accuracy,
            clockInAddress: location.address
          })
        },
        create: {
          employeeId: user.employee.id,
          workDate: todayStart,
          clockInTime: currentTime,
          status: 'PRESENT',
          // 新增GPS位置資訊
          ...(location && {
            clockInLatitude: location.latitude,
            clockInLongitude: location.longitude,
            clockInAccuracy: location.accuracy,
            clockInAddress: location.address
          })
        }
      });

      // 檢查是否需要填寫提早上班原因
      const reasonPromptData = skipReasonPrompt || !todaySchedule?.startTime
        ? null
        : buildClockReasonPromptData({
            settings: reasonPromptSettings,
            type: 'EARLY_IN',
            scheduledTime: todaySchedule.startTime,
            actualTime: currentTaiwanTime,
            recordId: attendance.id,
          });

      return NextResponse.json({ 
        message: '上班打卡成功',
        clockInTime: currentTime,
        attendance: attendance,
        requiresReason: !!reasonPromptData,
        reasonPrompt: reasonPromptData
      });

    } else if (type === 'out') {
      // 下班打卡 - 移除必須先上班打卡的限制
      let attendance;
      
      if (existingAttendance) {
        // 如果已有記錄，檢查是否已打下班卡
        if (existingAttendance.clockOutTime) {
          return NextResponse.json({ error: '今日已打過下班卡' }, { status: 400 });
        }
        // 計算工作時間（如果有上班打卡時間）
        let regularHours = 0;
        let overtimeHours = 0;
        
        if (existingAttendance.clockInTime) {
          const clockInTime = new Date(existingAttendance.clockInTime);
          const clockOutTime = new Date(currentTime);
          const hours = calculateAttendanceHours(
            clockInTime,
            clockOutTime,
            undefined,
            todaySchedule?.breakTime || 0
          );

          regularHours = hours.regularHours;
          overtimeHours = hours.overtimeHours;
        }

        // 更新現有記錄
        attendance = await prisma.attendanceRecord.update({
          where: { id: existingAttendance.id },
          data: {
            clockOutTime: currentTime,
            regularHours: parseFloat(regularHours.toFixed(2)),
            overtimeHours: parseFloat(overtimeHours.toFixed(2)),
            // 新增GPS位置資訊
            ...(location && {
              clockOutLatitude: location.latitude,
              clockOutLongitude: location.longitude,
              clockOutAccuracy: location.accuracy,
              clockOutAddress: location.address
            })
          }
        });
      } else {
        // 如果沒有記錄，創建只有下班打卡的新記錄
        attendance = await prisma.attendanceRecord.create({
          data: {
            employeeId: user.employee.id,
            workDate: todayStart,
            clockOutTime: currentTime,
            status: 'PRESENT',
            regularHours: 0,
            overtimeHours: 0,
            // 新增GPS位置資訊
            ...(location && {
              clockOutLatitude: location.latitude,
              clockOutLongitude: location.longitude,
              clockOutAccuracy: location.accuracy,
              clockOutAddress: location.address
            })
          }
        });
      }

      const workHours = (attendance.regularHours || 0) + (attendance.overtimeHours || 0);

      // 檢查是否需要填寫延後下班原因
      const reasonPromptData = skipReasonPrompt || !todaySchedule?.endTime
        ? null
        : buildClockReasonPromptData({
            settings: reasonPromptSettings,
            type: 'LATE_OUT',
            scheduledTime: todaySchedule.endTime,
            actualTime: currentTaiwanTime,
            recordId: attendance.id,
          });

      return NextResponse.json({ 
        message: '下班打卡成功',
        clockOutTime: currentTime,
        workHours: parseFloat(workHours.toFixed(2)),
        regularHours: attendance.regularHours,
        overtimeHours: attendance.overtimeHours,
        attendance: attendance,
        requiresReason: !!reasonPromptData,
        reasonPrompt: reasonPromptData
      });
    }

  } catch (error) {
    console.error('Failed to process attendance clock request', error);
    return NextResponse.json({ error: '系統錯誤，請稍後再試' }, { status: 500 });
  }
}
