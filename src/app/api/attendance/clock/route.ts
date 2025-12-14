import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// GET - 獲取今日打卡狀態
export async function GET(request: NextRequest) {
  try {
    console.log('🔍 打卡狀態檢查開始');
    
    // 檢查可用的 cookies
    const authToken = request.cookies.get('auth-token')?.value;
    const token = request.cookies.get('token')?.value;
    console.log('📋 可用的 Cookies:', { 
      'auth-token': authToken ? '存在' : '不存在',
      'token': token ? '存在' : '不存在'
    });

    // 使用統一的身份驗證方式
    const userAuth = getUserFromRequest(request);
    console.log('🔐 身份驗證結果:', userAuth ? '成功' : '失敗');
    
    if (!userAuth) {
      console.log('❌ 用戶未登入');
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const userId = userAuth.userId;
    console.log('👤 用戶 ID:', userId);

    // 獲取用戶的員工資料
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: true }
    });

    if (!user || !user.employee) {
      console.log('❌ 找不到員工資料，用戶:', user?.id, '員工:', user?.employee?.id);
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    console.log('👥 員工資料:', { id: user.employee.id, name: user.employee.name });

    // 獲取今日日期
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    console.log('📅 今日日期範圍:', { start: todayStart, end: todayEnd });

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

    console.log('📊 今日考勤記錄:', todayAttendance);

    const result = {
      hasClockIn: todayAttendance?.clockInTime != null,
      hasClockOut: todayAttendance?.clockOutTime != null,
      today: todayAttendance
    };

    console.log('✅ 返回結果:', result);
    return NextResponse.json(result);

  } catch (error) {
    console.error('💥 獲取打卡狀態錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 智能打卡
export async function POST(request: NextRequest) {
  try {
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

    const { type, location } = await request.json();

    if (!type || !['in', 'out'].includes(type)) {
      return NextResponse.json({ error: '無效的打卡類型' }, { status: 400 });
    }

    // 使用統一的身份驗證方式
    const userAuth = getUserFromRequest(request);
    
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

    // 獲取今日日期和當前時間
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
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

      return NextResponse.json({ 
        message: '上班打卡成功',
        clockInTime: currentTime,
        attendance: attendance
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
          const workHours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
          
          // 標準工時8小時，超過的算加班
          regularHours = Math.min(workHours, 8);
          overtimeHours = Math.max(0, workHours - 8);
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

      return NextResponse.json({ 
        message: '下班打卡成功',
        clockOutTime: currentTime,
        workHours: parseFloat(workHours.toFixed(2)),
        regularHours: attendance.regularHours,
        overtimeHours: attendance.overtimeHours,
        attendance: attendance
      });
    }

  } catch (error) {
    console.error('打卡錯誤:', error);
    return NextResponse.json({ error: '系統錯誤，請稍後再試' }, { status: 500 });
  }
}
