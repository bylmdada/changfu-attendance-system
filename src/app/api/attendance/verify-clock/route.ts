import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyPassword } from '@/lib/auth';
import { checkClockRateLimit, recordFailedClockAttempt, clearFailedAttempts, getClientIP } from '@/lib/rate-limit';
import { canEmployeeClockIn } from '@/lib/schedule-confirm-service';
import { getActiveAllowedLocations, getGPSSettingsFromDB, isClockLocationPayload, validateGpsClockLocation } from '@/lib/gps-attendance';
import { isMobileClockingDevice, MOBILE_CLOCKING_REQUIRED_MESSAGE } from '@/lib/device-detection';
import { getTaiwanTodayEnd, getTaiwanTodayStart, toTaiwanDateStr } from '@/lib/timezone';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    if (!isMobileClockingDevice(request.headers.get('user-agent'))) {
      return NextResponse.json({ error: MOBILE_CLOCKING_REQUIRED_MESSAGE }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '缺少必要參數'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (body.location !== undefined && body.location !== null && !isClockLocationPayload(body.location)) {
      return NextResponse.json({ error: 'GPS定位資料格式錯誤' }, { status: 400 });
    }

    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const location = body.location === undefined || body.location === null ? null : body.location;
    // 支援兩種參數名：type (前端快速打卡) 和 clockType (原有系統)
    const clockType = typeof body.type === 'string'
      ? body.type
      : typeof body.clockType === 'string'
        ? body.clockType
        : undefined;

    // 🔒 速率限制檢查
    const rateLimitResult = await checkClockRateLimit(request, username);
    if (!rateLimitResult.allowed) {
      console.log('⚠️ 速率限制拒絕:', username, rateLimitResult.reason);
      return NextResponse.json(
        { error: rateLimitResult.reason },
        { 
          status: 429,
          headers: { 'Retry-After': String(rateLimitResult.retryAfter || 60) }
        }
      );
    }

    // ⏰ 打卡時間限制檢查（從資料庫讀取設定）
    const clockRestriction = await prisma.systemSettings.findUnique({
      where: { key: 'clock_time_restriction' }
    });
    
    const restrictionSettings = clockRestriction 
      ? JSON.parse(clockRestriction.value)
      : { enabled: true, restrictedStartHour: 23, restrictedEndHour: 5, message: '夜間時段暫停打卡服務' };
    
    if (restrictionSettings.enabled) {
      const checkTime = new Date();
      const taiwanNow = new Date(checkTime.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
      // 使用台灣時區 (UTC+8) 取得當前小時，避免伺服器 UTC 時區造成誤判
      const taiwanHour = taiwanNow.getHours();
      const currentHour = taiwanHour;
      const startHour = restrictionSettings.restrictedStartHour;
      const endHour = restrictionSettings.restrictedEndHour;
      
      // 判斷是否在限制時段內（處理跨日情況）
      let isRestrictedTime = false;
      if (startHour > endHour) {
        // 跨日情況：如 23:00 - 05:00
        isRestrictedTime = currentHour >= startHour || currentHour < endHour;
      } else {
        // 同日情況：如 02:00 - 06:00
        isRestrictedTime = currentHour >= startHour && currentHour < endHour;
      }
      
      if (isRestrictedTime) {
        console.log('⛔ 時段限制拒絕打卡:', username, '台灣時間:', taiwanHour, '時 UTC時間:', checkTime.toISOString());
        return NextResponse.json({
          error: `${restrictionSettings.message}（${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00）`,
          restrictedUntil: `${String(endHour).padStart(2, '0')}:00`
        }, { status: 403 });
      }
    }

    if (!username || !password || !clockType) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (!['in', 'out'].includes(clockType)) {
      return NextResponse.json({ error: '無效的打卡類型' }, { status: 400 });
    }

    const clientIP = getClientIP(request);
    console.log('🔐 開始打卡驗證，用戶:', username, '類型:', clockType, 'IP:', clientIP);

    // 獲取GPS設定
    const gpsSettings = await getGPSSettingsFromDB();
    const allowedLocations = gpsSettings.enabled ? await getActiveAllowedLocations() : [];
    const gpsValidation = validateGpsClockLocation({
      gpsSettings,
      location,
      allowedLocations,
    });

    if (!gpsValidation.ok) {
      return NextResponse.json(
        {
          error: gpsValidation.error,
          code: gpsValidation.code,
        },
        { status: 400 }
      );
    }

    // 查找用戶
    const user = await prisma.user.findUnique({
      where: { username },
      include: { employee: true }
    });

    if (!user) {
      console.log('❌ 用戶不存在:', username);
      recordFailedClockAttempt(username);
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    if (!user.isActive) {
      console.log('❌ 帳號已停用:', username);
      recordFailedClockAttempt(username);
      return NextResponse.json({ error: '帳號已停用，請聯繫管理員' }, { status: 401 });
    }

    // 驗證密碼
    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      console.log('❌ 密碼驗證失敗:', username);
      recordFailedClockAttempt(username);
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    if (!user.employee) {
      console.log('❌ 找不到員工資料:', username);
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    console.log('✅ 用戶驗證成功:', username, '員工ID:', user.employee.id);
    clearFailedAttempts(username);

    // 獲取今日日期和當前時間（使用台灣時區）
    const now = new Date();
    const taiwanNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const todayStart = getTaiwanTodayStart(now);
    const todayEnd = getTaiwanTodayEnd(now);
    const currentTime = now.toISOString();

    // 📝 班表確認檢查（只對上班打卡檢查）
    if (clockType === 'in') {
      const clockPermission = await canEmployeeClockIn(user.employee.id, now);
      if (!clockPermission.allowed) {
        console.log('⛔ 班表未確認拒絕打卡:', username, clockPermission.reason);
        return NextResponse.json({
          error: clockPermission.reason || '請先確認本月班表後再打卡',
          code: 'SCHEDULE_NOT_CONFIRMED'
        }, { status: 403 });
      }
    }

    if (clockType === 'in') {
      // 上班打卡
      // 檢查是否已經打過上班卡
      const existingAttendance = await prisma.attendanceRecord.findFirst({
        where: {
          employeeId: user.employee.id,
          workDate: {
            gte: todayStart,
            lt: todayEnd
          },
          clockInTime: { not: null }
        }
      });

      if (existingAttendance) {
        return NextResponse.json({ error: '今日已打過上班卡' }, { status: 400 });
      }

      // GPS 位置數據 - 已恢復功能
      const locationData = location ? {
        clockInLatitude: location.latitude,
        clockInLongitude: location.longitude,
        clockInAccuracy: location.accuracy,
        clockInAddress: location.address || null
      } : {};

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
          ...locationData
        },
        create: {
          employeeId: user.employee.id,
          workDate: todayStart,
          clockInTime: currentTime,
          status: 'PRESENT',
          ...locationData
        }
      });

      console.log('✅ 上班打卡成功:', attendance);

      return NextResponse.json({ 
        message: `${user.employee.name} 上班打卡成功`,
        clockInTime: currentTime,
        employee: user.employee.name,
        attendance: attendance
      });

    } else if (clockType === 'out') {
      // 下班打卡 - 移除「必須先打上班卡」的限制
      // 查找今日考勤記錄（無論是否有上班打卡）
      const existingAttendance = await prisma.attendanceRecord.findFirst({
        where: {
          employeeId: user.employee.id,
          workDate: {
            gte: todayStart,
            lt: todayEnd
          }
        }
      });

      // 查詢今日班表以判斷是否超時下班
      const todayStr = toTaiwanDateStr(now);
      const todaySchedule = await prisma.schedule.findFirst({
        where: {
          employeeId: user.employee.id,
          workDate: todayStr
        }
      });

      // 判斷是否超過班表下班時間
      let isLateClockOut = false;
      let lateClockOutMinutes = 0;
      if (todaySchedule && todaySchedule.endTime) {
        const [scheduleEndHour, scheduleEndMin] = todaySchedule.endTime.split(':').map(Number);
        const clockOutHour = taiwanNow.getHours();
        const clockOutMin = taiwanNow.getMinutes();
        lateClockOutMinutes = (clockOutHour * 60 + clockOutMin) - (scheduleEndHour * 60 + scheduleEndMin);
        
        // 打卡時間超過班表結束時間 = 超時下班
        if (lateClockOutMinutes > 0) {
          isLateClockOut = true;
        }
      }

      // 取得前端傳來的超時原因（如果有）
      const rawClockOutReason = typeof body.lateClockOutReason === 'string'
        ? body.lateClockOutReason
        : typeof body.clockOutReason === 'string'
          ? body.clockOutReason
          : '';
      const clockOutReason = rawClockOutReason || null;

      let attendance;

      if (existingAttendance) {
        // 檢查是否已經打過下班卡
        if (existingAttendance.clockOutTime) {
          return NextResponse.json({ error: '今日已打過下班卡' }, { status: 400 });
        }

        // 計算工作時間（如果有上班打卡時間）
        let regularHours = 0;
        const overtimeHours = 0; // 加班時數由申請流程計算，打卡不自動計算
        let workHours = 0;
        
        if (existingAttendance.clockInTime) {
          const clockInTime = new Date(existingAttendance.clockInTime);
          const clockOutTime = new Date(currentTime);
          workHours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
          
          // 全部計為正常工時，加班須透過申請流程
          regularHours = workHours;
        }

        // GPS 位置數據 - 已恢復功能
        const locationData = location ? {
          clockOutLatitude: location.latitude,
          clockOutLongitude: location.longitude,
          clockOutAccuracy: location.accuracy,
          clockOutAddress: location.address || null
        } : {};

        // 更新現有記錄
        attendance = await prisma.attendanceRecord.update({
          where: { id: existingAttendance.id },
          data: {
            clockOutTime: currentTime,
            regularHours: parseFloat(regularHours.toFixed(2)),
            overtimeHours: parseFloat(overtimeHours.toFixed(2)),
            clockOutReason: clockOutReason,
            ...locationData
          }
        });

        let reasonPromptData = null;
        try {
          const reasonPromptSetting = await prisma.systemSettings.findUnique({
            where: { key: 'clock_reason_prompt' }
          });
          const settings = reasonPromptSetting ? JSON.parse(reasonPromptSetting.value) : { enabled: false };

          if (settings.enabled && todaySchedule?.endTime && lateClockOutMinutes >= Number(settings.lateClockOutThreshold ?? 0)) {
            reasonPromptData = {
              type: 'LATE_OUT',
              minutesDiff: Math.floor(lateClockOutMinutes),
              scheduledTime: todaySchedule.endTime,
              recordId: attendance.id
            };
          }
        } catch {
          console.warn('檢查延後打卡設定失敗');
        }

        console.log('✅ 下班打卡成功（更新記錄）:', attendance, '超時下班:', isLateClockOut);

        return NextResponse.json({ 
          message: `${user.employee.name} 下班打卡成功`,
          clockOutTime: currentTime,
          workHours: parseFloat(workHours.toFixed(2)),
          regularHours: parseFloat(regularHours.toFixed(2)),
          overtimeHours: parseFloat(overtimeHours.toFixed(2)),
          employee: user.employee.name,
          attendance: attendance,
          isLateClockOut: isLateClockOut,
          scheduleEndTime: todaySchedule?.endTime || null,
          requiresReason: !!reasonPromptData,
          reasonPrompt: reasonPromptData
        });

      } else {
        // 如果沒有記錄，創建只有下班打卡的新記錄
        // GPS 位置數據 - 已恢復功能
        const locationData = location ? {
          clockOutLatitude: location.latitude,
          clockOutLongitude: location.longitude,
          clockOutAccuracy: location.accuracy,
          clockOutAddress: location.address || null
        } : {};

        attendance = await prisma.attendanceRecord.create({
          data: {
            employeeId: user.employee.id,
            workDate: todayStart,
            clockOutTime: currentTime,
            status: 'PRESENT',
            regularHours: 0,
            overtimeHours: 0,
            clockOutReason: clockOutReason,
            ...locationData
          }
        });

        let reasonPromptData = null;
        try {
          const reasonPromptSetting = await prisma.systemSettings.findUnique({
            where: { key: 'clock_reason_prompt' }
          });
          const settings = reasonPromptSetting ? JSON.parse(reasonPromptSetting.value) : { enabled: false };

          if (settings.enabled && todaySchedule?.endTime && lateClockOutMinutes >= Number(settings.lateClockOutThreshold ?? 0)) {
            reasonPromptData = {
              type: 'LATE_OUT',
              minutesDiff: Math.floor(lateClockOutMinutes),
              scheduledTime: todaySchedule.endTime,
              recordId: attendance.id
            };
          }
        } catch {
          console.warn('檢查延後打卡設定失敗');
        }

        console.log('✅ 下班打卡成功（新建記錄）:', attendance, '超時下班:', isLateClockOut);

        return NextResponse.json({ 
          message: `${user.employee.name} 下班打卡成功`,
          clockOutTime: currentTime,
          workHours: 0,
          regularHours: 0,
          overtimeHours: 0,
          employee: user.employee.name,
          attendance: attendance,
          isLateClockOut: isLateClockOut,
          scheduleEndTime: todaySchedule?.endTime || null,
          requiresReason: !!reasonPromptData,
          reasonPrompt: reasonPromptData
        });
      }
    }

  } catch (error) {
    console.error('💥 打卡驗證錯誤:', error);
    return NextResponse.json({ error: '系統錯誤，請稍後再試' }, { status: 500 });
  }
}
