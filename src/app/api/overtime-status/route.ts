import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

// GET - 取得即時加班狀態
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const employeeId = decoded.employeeId;
    const now = new Date();
    const taiwanNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const todayStart = new Date(Date.UTC(taiwanNow.getFullYear(), taiwanNow.getMonth(), taiwanNow.getDate()) - 8 * 60 * 60 * 1000);
    const monthStart = new Date(Date.UTC(taiwanNow.getFullYear(), taiwanNow.getMonth(), 1) - 8 * 60 * 60 * 1000);
    const monthEnd = new Date(Date.UTC(taiwanNow.getFullYear(), taiwanNow.getMonth() + 1, 1) - 8 * 60 * 60 * 1000);

    // 檢查今日是否有進行中的加班
    const todayRecords = await prisma.overtimeClockRecord.findMany({
      where: {
        employeeId,
        createdAt: { gte: todayStart }
      },
      orderBy: { createdAt: 'desc' }
    });

    let currentSession = null;
    const lastStart = todayRecords.find(r => r.clockType === 'START');
    const lastEnd = todayRecords.find(r => r.clockType === 'END');

    if (lastStart && (!lastEnd || lastEnd.createdAt < lastStart.createdAt)) {
      // 有進行中的加班
      const durationMs = now.getTime() - lastStart.clockTime.getTime();
      const durationMinutes = Math.floor(durationMs / (1000 * 60));
      const hours = Math.floor(durationMinutes / 60);
      const minutes = durationMinutes % 60;

      currentSession = {
        isActive: true,
        startTime: lastStart.clockTime,
        startTimeFormatted: lastStart.clockTime.toTimeString().slice(0, 5),
        duration: `${hours}h ${minutes}m`,
        durationMinutes,
        estimatedHours: Math.round(durationMinutes / 60 * 2) / 2  // 以 0.5 小時為單位四捨五入
      };
    } else {
      currentSession = {
        isActive: false,
        startTime: null,
        duration: null,
        estimatedHours: 0
      };
    }

    // 本月加班統計
    const monthlyApproved = await prisma.overtimeRequest.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        overtimeDate: {
          gte: monthStart,
          lte: monthEnd
        }
      }
    });

    const monthlyPending = await prisma.overtimeRequest.findMany({
      where: {
        employeeId,
        status: 'PENDING',
        overtimeDate: {
          gte: monthStart,
          lte: monthEnd
        }
      }
    });

    const totalApprovedHours = monthlyApproved.reduce((sum, r) => sum + r.totalHours, 0);
    const totalPendingHours = monthlyPending.reduce((sum, r) => sum + r.totalHours, 0);

    // 取得加班上限設定
    const limitSettings = await prisma.systemSettings.findUnique({
      where: { key: 'overtime_limit_settings' }
    });

    const limits = limitSettings 
      ? JSON.parse(limitSettings.value)
      : { monthlyLimit: 46, warningThreshold: 36, enabled: true };

    const remainingHours = limits.monthlyLimit - totalApprovedHours;
    let warningLevel: 'NORMAL' | 'WARNING' | 'EXCEEDED' = 'NORMAL';
    if (totalApprovedHours >= limits.monthlyLimit) {
      warningLevel = 'EXCEEDED';
    } else if (totalApprovedHours >= limits.warningThreshold) {
      warningLevel = 'WARNING';
    }

    return NextResponse.json({
      success: true,
      currentSession,
      monthlyStats: {
        approvedHours: totalApprovedHours,
        pendingHours: totalPendingHours,
        totalHours: totalApprovedHours + totalPendingHours,
        monthlyLimit: limits.monthlyLimit,
        remainingHours: Math.max(0, remainingHours),
        usagePercentage: Math.round(totalApprovedHours / limits.monthlyLimit * 100),
        warningLevel
      },
      todayRecords: todayRecords.slice(0, 5)  // 今日打卡記錄
    });
  } catch (error) {
    console.error('取得加班狀態失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
