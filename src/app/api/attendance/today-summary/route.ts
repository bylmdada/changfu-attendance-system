import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    // Debug: 檢查 cookies
    const authToken = request.cookies.get('auth-token')?.value;
    console.log('📊 [today-summary] Cookie檢查:', { 
      'auth-token': authToken ? '存在' : '不存在',
      hasAuthToken: !!authToken
    });

    const userPayload = getUserFromRequest(request);
    console.log('📊 [today-summary] 身份驗證:', userPayload ? '成功' : '失敗', userPayload ? { userId: userPayload.userId, role: userPayload.role } : null);
    
    if (!userPayload) {
      console.log('❌ [today-summary] 無效的身份驗證 - 返回 401');
      return NextResponse.json({ error: '需要登入' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userPayload.userId },
      include: {
        employee: true
      }
    });

    console.log('📊 [today-summary] 用戶查詢:', user ? { id: user.id, isActive: user.isActive, hasEmployee: !!user.employee } : '找不到用戶');

    if (!user || !user.isActive || !user.employee) {
      console.log('❌ [today-summary] 用戶狀態無效 - 返回 401');
      return NextResponse.json({ error: '需要登入' }, { status: 401 });
    }

    const today = new Date();
    const taiwanToday = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const todayStr = `${taiwanToday.getFullYear()}-${String(taiwanToday.getMonth() + 1).padStart(2, '0')}-${String(taiwanToday.getDate()).padStart(2, '0')}`;

    // 查詢今日考勤記錄
    const todayRecord = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: {
          gte: new Date(todayStr + 'T00:00:00.000Z'),
          lt: new Date(todayStr + 'T23:59:59.999Z')
        }
      }
    });

    // 查詢今日排班資訊
    const todaySchedule = await prisma.schedule.findFirst({
      where: {
        employeeId: user.employee.id,
        workDate: todayStr
      }
    });

    // 計算工作時數
    let workHours = 0;
    let overtimeHours = 0;
    
    if (todayRecord && todayRecord.clockInTime && todayRecord.clockOutTime) {
      const clockIn = new Date(todayRecord.clockInTime);
      const clockOut = new Date(todayRecord.clockOutTime);
      const totalMinutes = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60);
      
      if (totalMinutes > 0) {
        // 扣除休息時間 (假設1小時)
        const workMinutes = Math.max(0, totalMinutes - 60);
        workHours = Math.round((workMinutes / 60) * 100) / 100;
        
        // 計算加班時數 (超過8小時的部分)
        if (workHours > 8) {
          overtimeHours = Math.round((workHours - 8) * 100) / 100;
          workHours = 8;
        }
      }
    }

    // 如果是管理員，取得所有員工的今日出勤統計
    if (user.employee.position === 'MANAGER' || user.employee.position === 'ADMIN') {
      const todayAttendanceCount = await prisma.attendanceRecord.count({
        where: {
          workDate: {
            gte: new Date(todayStr + 'T00:00:00.000Z'),
            lt: new Date(todayStr + 'T23:59:59.999Z')
          },
          status: 'PRESENT'
        }
      });

      return NextResponse.json({
        success: true,
        attendanceCount: todayAttendanceCount,
        data: {
          date: todayStr,
          employee: {
            name: user.employee.name,
            employeeId: user.employee.employeeId,
            department: user.employee.department
          },
          schedule: todaySchedule ? {
            shiftType: todaySchedule.shiftType,
            startTime: todaySchedule.startTime,
            endTime: todaySchedule.endTime
          } : null,
          attendance: todayRecord ? {
            clockInTime: todayRecord.clockInTime?.toISOString() || null,
            clockOutTime: todayRecord.clockOutTime?.toISOString() || null,
            status: todayRecord.status,
            notes: todayRecord.notes
          } : null,
          workSummary: {
            regularHours: workHours,
            overtimeHours: overtimeHours,
            totalHours: workHours + overtimeHours
          }
        }
      });
    }

    // 一般員工回傳個人資料
    return NextResponse.json({
      success: true,
      data: {
        date: todayStr,
        employee: {
          name: user.employee.name,
          employeeId: user.employee.employeeId,
          department: user.employee.department
        },
        schedule: todaySchedule ? {
          shiftType: todaySchedule.shiftType,
          startTime: todaySchedule.startTime,
          endTime: todaySchedule.endTime
        } : null,
        attendance: todayRecord ? {
          clockInTime: todayRecord.clockInTime?.toISOString() || null,
          clockOutTime: todayRecord.clockOutTime?.toISOString() || null,
          status: todayRecord.status,
          notes: todayRecord.notes
        } : null,
        workSummary: {
          regularHours: workHours,
          overtimeHours: overtimeHours,
          totalHours: workHours + overtimeHours
        }
      }
    });

  } catch (error) {
    console.error('取得今日考勤摘要失敗:', error);
    return NextResponse.json(
      { error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}
