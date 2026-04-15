import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyPassword } from '@/lib/auth';
import { checkClockRateLimit, clearFailedAttempts, recordFailedClockAttempt } from '@/lib/rate-limit';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供帳號和密碼'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供帳號和密碼' }, { status: 400 });
    }

    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      return NextResponse.json({ error: '請提供帳號和密碼' }, { status: 400 });
    }

    const rateLimitResult = await checkClockRateLimit(request, username);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: rateLimitResult.reason || '請求過於頻繁' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimitResult.retryAfter || 60) }
        }
      );
    }

    // 查找用戶
    const user = await prisma.user.findUnique({
      where: { username },
      include: { employee: true }
    });

    if (!user) {
      await recordFailedClockAttempt(username);
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    if (!user.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    if (!user.isActive) {
      await recordFailedClockAttempt(username);
      return NextResponse.json({ error: '帳號已停用，請聯繫管理員' }, { status: 401 });
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      await recordFailedClockAttempt(username);
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    await clearFailedAttempts(username);

    // 獲取今日日期（使用台灣時區）
    const now = new Date();
    const taiwanDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const todayStart = new Date(Date.UTC(taiwanDate.getFullYear(), taiwanDate.getMonth(), taiwanDate.getDate()) - 8 * 60 * 60 * 1000);
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // 查找今日打卡記錄
    const todayAttendance = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: {
          gte: todayStart,
          lt: todayEnd
        }
      }
    });

    // 查詢今日排班（使用台灣日期）
    const todayStr = `${taiwanDate.getFullYear()}-${String(taiwanDate.getMonth() + 1).padStart(2, '0')}-${String(taiwanDate.getDate()).padStart(2, '0')}`;
    const todaySchedule = await prisma.schedule.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: todayStr
      }
    });

    // 查詢當月異常記錄（遲到、早退、缺上班、缺下班）
    const monthStart = new Date(Date.UTC(taiwanDate.getFullYear(), taiwanDate.getMonth(), 1) - 8 * 60 * 60 * 1000);
    const monthEnd = new Date(Date.UTC(taiwanDate.getFullYear(), taiwanDate.getMonth() + 1, 1) - 8 * 60 * 60 * 1000);
    
    // 取得當月所有考勤記錄
    const monthlyAttendance = await prisma.attendanceRecord.findMany({
      where: {
        employeeId: user.employee.id,
        workDate: {
          gte: monthStart,
          lte: monthEnd
        }
      },
      orderBy: { workDate: 'desc' }
    });

    // 取得當月所有排班
    const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEndStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
    
    const monthlySchedules = await prisma.schedule.findMany({
      where: {
        employeeId: user.employee.id,
        workDate: {
          gte: monthStartStr,
          lte: monthEndStr
        }
      }
    });

    // 將排班轉為 Map 方便查詢
    const scheduleMap = new Map<string, { shiftType: string; startTime: string; endTime: string }>();
    for (const s of monthlySchedules) {
      scheduleMap.set(s.workDate, {
        shiftType: s.shiftType,
        startTime: s.startTime,
        endTime: s.endTime
      });
    }

    // 分析異常記錄
    const anomalyRecords: {
      date: string;
      shiftCode: string;
      shiftTime: string;
      scheduledClockIn: string;
      actualClockIn: string;
      scheduledClockOut: string;
      actualClockOut: string;
      status: string;
    }[] = [];

    for (const attendance of monthlyAttendance) {
      const dateStr = attendance.workDate.toISOString().split('T')[0];
      const schedule = scheduleMap.get(dateStr);
      
      if (!schedule) continue; // 無排班則跳過

      // 排班時間
      const scheduledClockIn = schedule.startTime;
      const scheduledClockOut = schedule.endTime;
      const shiftTime = `${scheduledClockIn}-${scheduledClockOut}`;

      // 實際打卡時間
      const actualClockIn = attendance.clockInTime 
        ? new Date(attendance.clockInTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '--';
      const actualClockOut = attendance.clockOutTime 
        ? new Date(attendance.clockOutTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '--';

      // 判斷異常狀態
      const anomalies: string[] = [];
      
      // 缺上班打卡
      if (!attendance.clockInTime) {
        anomalies.push('缺上班');
      } else {
        // 遲到檢測
        const [schInHour, schInMin] = scheduledClockIn.split(':').map(Number);
        const clockIn = new Date(attendance.clockInTime);
        const scheduledTime = new Date(clockIn);
        scheduledTime.setHours(schInHour, schInMin, 0, 0);
        if (clockIn > scheduledTime) {
          const diffMinutes = Math.round((clockIn.getTime() - scheduledTime.getTime()) / 60000);
          if (diffMinutes > 0) {
            anomalies.push(`遲到${diffMinutes}分鐘`);
          }
        }
      }

      // 缺下班打卡
      if (!attendance.clockOutTime) {
        // 只有今天以前的記錄才算缺下班
        if (new Date(dateStr) < todayStart) {
          anomalies.push('缺下班');
        }
      } else {
        // 早退檢測
        const [schOutHour, schOutMin] = scheduledClockOut.split(':').map(Number);
        const clockOut = new Date(attendance.clockOutTime);
        const scheduledOutTime = new Date(clockOut);
        scheduledOutTime.setHours(schOutHour, schOutMin, 0, 0);
        if (clockOut < scheduledOutTime) {
          const diffMinutes = Math.round((scheduledOutTime.getTime() - clockOut.getTime()) / 60000);
          if (diffMinutes > 0) {
            anomalies.push(`早退${diffMinutes}分鐘`);
          }
        }
      }

      // 只記錄有異常的記錄
      if (anomalies.length > 0) {
        anomalyRecords.push({
          date: dateStr.replace(/-/g, '/'),
          shiftCode: schedule.shiftType,
          shiftTime,
          scheduledClockIn,
          actualClockIn,
          scheduledClockOut,
          actualClockOut,
          status: anomalies.join('、')
        });
      }
    }

    const employeeInfo = {
      id: user.employee.id,
      employeeId: user.employee.employeeId,
      name: user.employee.name,
      department: user.employee.department,
      position: user.employee.position
    };

    if (!todayAttendance) {
      // 今日尚未打卡
      return NextResponse.json({
        employee: employeeInfo,
        hasClockIn: false,
        hasClockOut: false,
        clockInTime: null,
        clockOutTime: null,
        workHours: 0,
        attendance: null,
        // 新增：今日排班
        todaySchedule: todaySchedule ? {
          date: todayStr.replace(/-/g, '/'),
          shiftCode: todaySchedule.shiftType,
          shiftTime: `${todaySchedule.startTime} - ${todaySchedule.endTime}`
        } : null,
        // 新增：當月異常記錄
        anomalyRecords
      });
    }

    // 計算工作時間
    let workHours = 0;
    if (todayAttendance.clockInTime && todayAttendance.clockOutTime) {
      const clockIn = new Date(todayAttendance.clockInTime);
      const clockOut = new Date(todayAttendance.clockOutTime);
      workHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
    }

    return NextResponse.json({
      employee: employeeInfo,
      hasClockIn: !!todayAttendance.clockInTime,
      hasClockOut: !!todayAttendance.clockOutTime,
      clockInTime: todayAttendance.clockInTime,
      clockOutTime: todayAttendance.clockOutTime,
      workHours: parseFloat(workHours.toFixed(2)),
      regularHours: todayAttendance.regularHours || 0,
      overtimeHours: todayAttendance.overtimeHours || 0,
      attendance: todayAttendance,
      // 新增：今日排班
      todaySchedule: todaySchedule ? {
        date: todayStr.replace(/-/g, '/'),
        shiftCode: todaySchedule.shiftType,
        shiftTime: `${todaySchedule.startTime} - ${todaySchedule.endTime}`
      } : null,
      // 新增：當月異常記錄
      anomalyRecords
    });

  } catch (error) {
    console.error('檢查打卡記錄錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

