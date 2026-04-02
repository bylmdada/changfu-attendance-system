import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { checkRateLimit } from '@/lib/rate-limit';
import { toTaiwanDateStr } from '@/lib/timezone';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';

// 簡易型別：避免直接耦合到 Prisma 生成客戶端
interface ScheduleLite { shiftType: string; startTime: string; endTime: string }
interface PrismaWithSchedule {
  schedule?: {
    findFirst: (args: { where: Record<string, unknown>; select: { shiftType: boolean; startTime: boolean; endTime: boolean } }) => Promise<ScheduleLite | null>
  }
}
const db = prisma as unknown as PrismaWithSchedule;

const SHIFT_LABEL = (t: string, s: string, e: string) => {
  const nameMap: Record<string, string> = {
    A: 'A班', B: 'B班', C: 'C班', NH: 'NH', RD: 'RD', rd: 'rd', FDL: 'FDL', OFF: 'OFF'
  };
  const n = nameMap[t] || t;
  return s && e ? `${n} (${s}-${e})` : n;
};

// 獲取加班申請列表
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
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

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const status = searchParams.get('status');

    const whereClause: {
      employeeId?: number;
      overtimeDate?: { gte: Date; lte: Date };
      status?: string;
    } = {};

    // 如果是一般員工，只能看自己的申請
    if (decoded.role === 'EMPLOYEE') {
      whereClause.employeeId = decoded.employeeId;
    } else if (employeeId) {
      // 管理員可以查看特定員工的申請
      whereClause.employeeId = parseInt(employeeId);
    }

    if (startDate && endDate) {
      whereClause.overtimeDate = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (status) {
      whereClause.status = status;
    }

    const overtimeRequestsRaw = await prisma.overtimeRequest.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        approver: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // 取得加班當日班別（若 Schedule 模型可用）
    const overtimeRequests = await Promise.all(
      overtimeRequestsRaw.map(async (req) => {
        if (!db.schedule) return { ...req, scheduleShiftType: null, scheduleStartTime: null, scheduleEndTime: null, scheduleShiftLabel: null };
        const ymd = toTaiwanDateStr(new Date(req.overtimeDate)); // 我們 Schedule 使用字串 YYYY-MM-DD
        const schedule = await db.schedule.findFirst({
          where: { employeeId: req.employeeId, workDate: ymd },
          select: { shiftType: true, startTime: true, endTime: true }
        });
        return {
          ...req,
          scheduleShiftType: schedule?.shiftType || null,
          scheduleStartTime: schedule?.startTime || null,
          scheduleEndTime: schedule?.endTime || null,
          scheduleShiftLabel: schedule ? SHIFT_LABEL(schedule.shiftType, schedule.startTime, schedule.endTime) : null
        };
      })
    );

    return NextResponse.json({
      success: true,
      overtimeRequests
    });
  } catch (error) {
    console.error('獲取加班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 提交加班申請
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const { overtimeDate, workDate, startTime, endTime, reason, workContent, username, password } = body;

    // 雙重認證：Token 或帳密
    let employeeId: number | null = null;
    
    // 模式1: Token 認證
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (token) {
      const decoded = await getUserFromToken(token);
      if (decoded) {
        employeeId = decoded.employeeId;
      }
    }
    
    // 模式2: 帳密認證（快速打卡模式）
    if (!employeeId && username && password) {
      const { verifyPassword } = await import('@/lib/auth');
      const user = await prisma.user.findUnique({
        where: { username },
        include: { employee: true }
      });
      
      if (user && user.employee) {
        const isValid = await verifyPassword(password, user.passwordHash);
        if (isValid) {
          employeeId = user.employee.id;
        }
      }
    }
    
    if (!employeeId) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 如果是帳密認證，跳過 CSRF 檢查
    if (!username) {
      const csrfResult = await validateCSRF(request);
      if (!csrfResult.valid) {
        return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
      }
    }

    // 支援兩種日期參數名（overtimeDate 或 workDate）
    const finalOvertimeDate = overtimeDate || workDate;

    if (!finalOvertimeDate || !startTime || !endTime || !reason) {
      return NextResponse.json({ error: '加班日期、開始時間、結束時間和申請原因為必填' }, { status: 400 });
    }

    // 檢查凍結狀態
    const overtimeDateObj = new Date(finalOvertimeDate);
    const freezeCheck = await checkAttendanceFreeze(overtimeDateObj);

    if (freezeCheck.isFrozen) {
      const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW');
      return NextResponse.json({
        error: `該月份已被凍結，無法提交加班申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
      }, { status: 403 });
    }

    // 驗證開始時間（必須在17:00之後，即正常8小時工作後）
    const [startHour] = startTime.split(':').map(Number);
    if (startHour < 17) {
      return NextResponse.json({ error: '加班開始時間必須在17:00之後（正常工作8小時後）' }, { status: 400 });
    }

    // 計算加班時數
    const totalHours = calculateOvertimeHours(startTime, endTime);

    // 驗證加班時數
    if (totalHours < 0.5) {
      return NextResponse.json({ error: '加班時數最少0.5小時' }, { status: 400 });
    }

    if (totalHours > 4) {
      return NextResponse.json({ error: '單日加班時數不能超過4小時' }, { status: 400 });
    }

    // 檢查當天是否已有申請
    const existingRequest = await prisma.overtimeRequest.findFirst({
      where: {
        employeeId: employeeId,
        overtimeDate: new Date(finalOvertimeDate),
        status: { in: ['PENDING', 'APPROVED'] }
      }
    });

    if (existingRequest) {
      return NextResponse.json({ error: '該日期已有加班申請' }, { status: 400 });
    }

    // 檢查總工時是否超過12小時（假設正常工時8小時 + 加班時數）
    const totalWorkHours = 8 + totalHours;
    if (totalWorkHours > 12) {
      return NextResponse.json({ error: '一天工作時間不能超過12小時' }, { status: 400 });
    }

    // ==================== 月加班上限檢查 ====================
    const limitSettings = await prisma.systemSettings.findUnique({
      where: { key: 'overtime_limit_settings' }
    });

    const limits = limitSettings 
      ? JSON.parse(limitSettings.value)
      : { monthlyLimit: 46, warningThreshold: 36, exceedMode: 'BLOCK', enabled: true };

    let overtimeLimitWarning = null;
    let requireForceReview = false;

    if (limits.enabled) {
      // 計算當月已核准的加班時數
      const overtimeDateObj = new Date(finalOvertimeDate);
      const twDate = new Date(overtimeDateObj.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
      const monthStart = new Date(Date.UTC(twDate.getFullYear(), twDate.getMonth(), 1) - 8 * 60 * 60 * 1000);
      const monthEnd = new Date(Date.UTC(twDate.getFullYear(), twDate.getMonth() + 1, 1) - 8 * 60 * 60 * 1000);

      const monthlyApproved = await prisma.overtimeRequest.findMany({
        where: {
          employeeId: employeeId,
          status: 'APPROVED',
          overtimeDate: {
            gte: monthStart,
            lte: monthEnd
          }
        }
      });

      const currentMonthHours = monthlyApproved.reduce((sum, req) => sum + req.totalHours, 0);
      const projectedHours = currentMonthHours + totalHours;

      // 檢查是否超過上限
      if (projectedHours > limits.monthlyLimit) {
        if (limits.exceedMode === 'BLOCK') {
          return NextResponse.json({ 
            error: `月加班時數超過上限！目前已核准 ${currentMonthHours} 小時，本次申請 ${totalHours} 小時，將超過上限 ${limits.monthlyLimit} 小時（勞基法規定）`,
            currentMonthHours,
            requestedHours: totalHours,
            monthlyLimit: limits.monthlyLimit
          }, { status: 400 });
        } else if (limits.exceedMode === 'FORCE_REVIEW') {
          // 標記需強制審核
          requireForceReview = true;
          overtimeLimitWarning = `月加班時數將超過上限 ${limits.monthlyLimit} 小時，本申請需強制審核`;
        }
      } else if (projectedHours >= limits.warningThreshold) {
        overtimeLimitWarning = `本月加班時數接近上限（已 ${currentMonthHours}h，申請後 ${projectedHours}h / 上限 ${limits.monthlyLimit}h）`;
      }
    }

    // 取得系統設定的補償模式（目前鎖定為補休）
    const compensationType = body.compensationType || 'COMP_LEAVE';
    
    // 驗證 compensationType 值
    if (!['COMP_LEAVE', 'OVERTIME_PAY'].includes(compensationType)) {
      return NextResponse.json({ error: '無效的補償方式' }, { status: 400 });
    }

    const overtimeRequest = await prisma.overtimeRequest.create({
      data: {
        employeeId: employeeId,
        overtimeDate: new Date(finalOvertimeDate),
        startTime,
        endTime,
        totalHours,
        reason,
        workContent: workContent || '',
        compensationType,
        status: 'PENDING'
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

    // 建立審核實例
    await createApprovalForRequest({
      requestType: 'OVERTIME',
      requestId: overtimeRequest.id,
      applicantId: overtimeRequest.employee.id,
      applicantName: overtimeRequest.employee.name,
      department: overtimeRequest.employee.department
    });

    return NextResponse.json({
      success: true,
      overtimeRequest,
      message: '加班申請提交成功，等待審核',
      warning: overtimeLimitWarning,
      requireForceReview
    });
  } catch (error) {
    console.error('提交加班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 計算加班時數（以0.5小時為最小單位）
function calculateOvertimeHours(startTime: string, endTime: string): number {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + endMinute;
  
  let totalMinutes = endTotalMinutes - startTotalMinutes;
  
  // 處理跨日情況
  if (totalMinutes < 0) {
    totalMinutes += 24 * 60;
  }
  
  // 轉換為小時，以0.5為最小單位進位
  const totalHours = totalMinutes / 60;
  return Math.ceil(totalHours * 2) / 2;
}
