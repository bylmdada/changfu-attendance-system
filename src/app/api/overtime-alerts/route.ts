import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

// GET - 取得加班警示（接近/超過上限員工）
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
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');

    const now = new Date();
    const year = yearParam ? parseInt(yearParam) : now.getFullYear();
    const month = monthParam ? parseInt(monthParam) : now.getMonth() + 1;

    // 取得上限設定
    const limitSettings = await prisma.systemSettings.findUnique({
      where: { key: 'overtime_limit_settings' }
    });

    const settings = limitSettings 
      ? JSON.parse(limitSettings.value)
      : { monthlyLimit: 46, warningThreshold: 36, enabled: true };

    if (!settings.enabled) {
      return NextResponse.json({
        success: true,
        alerts: [],
        message: '加班上限警示功能已停用'
      });
    }

    // 計算月份起訖
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // 取得當月所有已核准的加班
    const approvedOvertime = await prisma.overtimeRequest.findMany({
      where: {
        status: 'APPROVED',
        overtimeDate: {
          gte: startDate,
          lte: endDate
        }
      },
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
      }
    });

    // 按員工彙總
    const employeeHours: Record<number, {
      employee: typeof approvedOvertime[0]['employee'];
      totalHours: number;
      requests: number;
    }> = {};

    for (const overtime of approvedOvertime) {
      if (!employeeHours[overtime.employeeId]) {
        employeeHours[overtime.employeeId] = {
          employee: overtime.employee,
          totalHours: 0,
          requests: 0
        };
      }
      employeeHours[overtime.employeeId].totalHours += overtime.totalHours;
      employeeHours[overtime.employeeId].requests += 1;
    }

    // 分類警示
    const alerts = {
      exceeded: [] as typeof employeeHours[number][],   // 超過上限
      warning: [] as typeof employeeHours[number][],    // 接近上限
      normal: [] as typeof employeeHours[number][]      // 正常
    };

    for (const data of Object.values(employeeHours)) {
      if (data.totalHours >= settings.monthlyLimit) {
        alerts.exceeded.push(data);
      } else if (data.totalHours >= settings.warningThreshold) {
        alerts.warning.push(data);
      } else {
        alerts.normal.push(data);
      }
    }

    // 排序（時數高的在前）
    alerts.exceeded.sort((a, b) => b.totalHours - a.totalHours);
    alerts.warning.sort((a, b) => b.totalHours - a.totalHours);

    return NextResponse.json({
      success: true,
      period: { year, month },
      settings: {
        monthlyLimit: settings.monthlyLimit,
        warningThreshold: settings.warningThreshold
      },
      summary: {
        exceededCount: alerts.exceeded.length,
        warningCount: alerts.warning.length,
        totalEmployees: Object.keys(employeeHours).length
      },
      alerts
    });
  } catch (error) {
    console.error('取得加班警示失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
