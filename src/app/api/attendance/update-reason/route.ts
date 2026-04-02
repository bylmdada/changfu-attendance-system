import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, verifyPassword } from '@/lib/auth';

// POST - 更新下班打卡的超時原因
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { attendanceId, lateClockOutReason, clockOutReason: newClockOutReason, username, password } = body;
    
    // 支援新舊欄位名稱
    const reason = newClockOutReason || lateClockOutReason;

    // 驗證參數
    if (!attendanceId) {
      return NextResponse.json({ error: '缺少考勤記錄ID' }, { status: 400 });
    }

    if (!reason || !['PERSONAL', 'BUSINESS', 'WORK'].includes(reason)) {
      return NextResponse.json({ error: '請選擇有效的原因' }, { status: 400 });
    }

    // 查找考勤記錄
    const attendance = await prisma.attendanceRecord.findUnique({
      where: { id: attendanceId },
      include: { employee: true }
    });

    if (!attendance) {
      return NextResponse.json({ error: '找不到考勤記錄' }, { status: 404 });
    }

    // 驗證權限 - 支持兩種模式
    let isAuthorized = false;
    
    // 模式1: Cookie 認證 (已登入用戶)
    const user = await getUserFromRequest(request);
    if (user) {
      if (user.role === 'ADMIN' || attendance.employeeId === user.employeeId) {
        isAuthorized = true;
      }
    }
    
    // 模式2: 帳密認證 (快速打卡模式)
    if (!isAuthorized && username && password) {
      const userRecord = await prisma.user.findUnique({
        where: { username },
        include: { employee: true }
      });
      
      if (userRecord && userRecord.employee) {
        const isPasswordValid = await verifyPassword(password, userRecord.passwordHash);
        if (isPasswordValid && attendance.employeeId === userRecord.employee.id) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: '無權限修改此記錄' }, { status: 403 });
    }

    // 更新超時原因 - 使用新欄位名稱
    const finalReason = reason === 'WORK' ? 'BUSINESS' : reason; // 將舊的 WORK 轉換為 BUSINESS
    const updatedAttendance = await prisma.attendanceRecord.update({
      where: { id: attendanceId },
      data: { clockOutReason: finalReason }
    });

    console.log('✅ 超時下班原因已更新:', updatedAttendance);

    return NextResponse.json({
      success: true,
      message: '超時原因已記錄',
      attendance: updatedAttendance
    });

  } catch (error) {
    console.error('💥 更新超時原因失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
