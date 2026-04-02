import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

// 取得台灣時區的今日起始時間（UTC）
function getTaiwanTodayStart(now: Date): Date {
  const tw = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return new Date(Date.UTC(tw.getFullYear(), tw.getMonth(), tw.getDate()) - 8 * 60 * 60 * 1000);
}

// 計算兩點間距離（公尺）
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // 地球半徑（公尺）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// POST - GPS 加班打卡
export async function POST(request: NextRequest) {
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

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const body = await request.json();
    const { clockType, latitude, longitude, accuracy } = body;

    if (!clockType || !['START', 'END'].includes(clockType)) {
      return NextResponse.json({ error: '無效的打卡類型' }, { status: 400 });
    }

    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json({ error: '缺少 GPS 座標' }, { status: 400 });
    }

    const employeeId = decoded.employeeId;
    const now = new Date();

    // 驗證 GPS 位置
    let isValid = true;
    let invalidReason: string | null = null;

    // 取得允許的工作地點
    const allowedLocations = await prisma.allowedLocation.findMany({
      where: { isActive: true }
    });

    if (allowedLocations.length > 0) {
      let withinRange = false;
      for (const loc of allowedLocations) {
        const distance = calculateDistance(latitude, longitude, loc.latitude, loc.longitude);
        if (distance <= loc.radius) {
          withinRange = true;
          break;
        }
      }
      if (!withinRange) {
        isValid = false;
        invalidReason = '不在允許的工作地點範圍內';
      }
    }

    // 檢查是否已有未結束的加班
    if (clockType === 'START') {
      const activeSession = await prisma.overtimeClockRecord.findFirst({
        where: {
          employeeId,
          clockType: 'START',
          createdAt: {
            gte: getTaiwanTodayStart(now)
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      const hasEnd = activeSession ? await prisma.overtimeClockRecord.findFirst({
        where: {
          employeeId,
          clockType: 'END',
          createdAt: { gt: activeSession.createdAt }
        }
      }) : null;

      if (activeSession && !hasEnd) {
        return NextResponse.json({ 
          error: '已有進行中的加班，請先結束後再開始新的加班',
          activeSession
        }, { status: 400 });
      }
    }

    // 建立打卡記錄
    const clockRecord = await prisma.overtimeClockRecord.create({
      data: {
        employeeId,
        clockType,
        clockTime: now,
        latitude,
        longitude,
        accuracy,
        isValid,
        invalidReason
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        }
      }
    });

    // 如果是結束打卡，自動計算加班時數並建立申請
    let overtimeRequest = null;
    if (clockType === 'END' && isValid) {
      const startRecord = await prisma.overtimeClockRecord.findFirst({
        where: {
          employeeId,
          clockType: 'START',
          createdAt: {
            gte: getTaiwanTodayStart(now),
            lt: now
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (startRecord) {
        const startTime = startRecord.clockTime;
        const endTime = now;
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);  // 轉換為小時
        const totalHours = Math.round(durationHours * 2) / 2; // 以 0.5 小時為單位四捨五入

        if (totalHours >= 0.5) {
          overtimeRequest = await prisma.overtimeRequest.create({
            data: {
              employeeId,
              overtimeDate: getTaiwanTodayStart(now),
              startTime: startTime.toTimeString().slice(0, 5),
              endTime: endTime.toTimeString().slice(0, 5),
              totalHours,
              reason: '行動打卡加班',
              workContent: '',
              status: 'PENDING',
              compensationType: 'COMP_LEAVE'
            }
          });

          // 更新打卡記錄關聯
          await prisma.overtimeClockRecord.update({
            where: { id: clockRecord.id },
            data: { overtimeRequestId: overtimeRequest.id }
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: clockType === 'START' ? '加班開始打卡成功' : '加班結束打卡成功',
      clockRecord,
      overtimeRequest,
      isValid,
      invalidReason
    });
  } catch (error) {
    console.error('加班打卡失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
