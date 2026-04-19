import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendSchedulePublishNotification, sendReminderToUnconfirmed } from '@/lib/schedule-confirm-service';
import { parseYearMonthQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

/**
 * 班表確認 API
 * 
 * GET: 查詢確認狀態
 * POST: 確認班表 / 發布班表
 */

// 取得某月最後一天
function getLastDayOfMonth(yearMonth: string): Date {
  const [year, month] = yearMonth.split('-').map(Number);
  // 下個月的第0天 = 這個月的最後一天
  return new Date(year, month, 0, 23, 59, 59);
}

// 取得確認狀態
type ConfirmStatus = 
  | 'NOT_RELEASED'     // 尚未發布
  | 'PENDING'          // 待確認
  | 'CONFIRMED'        // 已確認
  | 'NEED_RECONFIRM'   // 班表異動需重新確認
  | 'EXPIRED';         // 已逾期未確認

interface ConfirmationRecord {
  id: number;
  version: number;
  confirmedAt: Date;
  isValid: boolean;
  comment: string | null;
}

interface ReleaseRecord {
  id: number;
  version: number;
  deadline: Date | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getConfirmStatus(release: ReleaseRecord | null, confirmation: ConfirmationRecord | null): ConfirmStatus {
  if (!release) return 'NOT_RELEASED';
  
  if (!confirmation) {
    const now = new Date();
    if (release.deadline && now > release.deadline) {
      return 'EXPIRED';
    }
    return 'PENDING';
  }
  
  // 班表版本大於確認時的版本 = 需重新確認
  if (release.version > confirmation.version) {
    return 'NEED_RECONFIRM';
  }
  
  if (!confirmation.isValid) {
    return 'NEED_RECONFIRM';
  }
  
  return 'CONFIRMED';
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/schedule-confirmation');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const rawYearMonth = searchParams.get('yearMonth');
    const department = searchParams.get('department');

    // 查詢員工自己的確認狀態
    if (type === 'my-status') {
      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, department: true }
      });

      if (!employee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
      }

      // 查詢發布記錄
      const release = await prisma.scheduleMonthlyRelease.findFirst({
        where: {
          yearMonth,
          OR: [
            { department: null },
            { department: employee.department || '' }
          ],
          status: 'PUBLISHED'
        },
        include: {
          publishedBy: { select: { name: true } },
          confirmations: {
            where: { employeeId: employee.id },
            take: 1
          }
        },
        orderBy: { publishedAt: 'desc' }
      });

      const confirmation = release?.confirmations[0] || null;
      const status = getConfirmStatus(release, confirmation);

      // 查詢班表摘要
      let scheduleSummary = null;
      if (release) {
        const schedules = await prisma.schedule.findMany({
          where: {
            employeeId: employee.id,
            workDate: {
              startsWith: yearMonth
            }
          }
        });

        const workDays = schedules.filter(s => !['RD', 'rd', 'OFF', 'FDL', 'NH'].includes(s.shiftType)).length;
        const restDays = schedules.filter(s => ['RD', 'rd', 'OFF'].includes(s.shiftType)).length;
        const shiftA = schedules.filter(s => s.shiftType === 'A').length;
        const shiftB = schedules.filter(s => s.shiftType === 'B').length;
        const shiftC = schedules.filter(s => s.shiftType === 'C').length;

        scheduleSummary = {
          total: schedules.length,
          workDays,
          restDays,
          shiftA,
          shiftB,
          shiftC
        };
      }

      return NextResponse.json({
        success: true,
        status,
        release: release ? {
          id: release.id,
          yearMonth: release.yearMonth,
          publishedAt: release.publishedAt.toISOString(),
          deadline: release.deadline?.toISOString(),
          version: release.version,
          lastModified: release.lastModified.toISOString(),
          publisherName: release.publishedBy.name
        } : null,
        confirmation: confirmation ? {
          id: confirmation.id,
          confirmedAt: confirmation.confirmedAt.toISOString(),
          version: confirmation.version,
          comment: confirmation.comment
        } : null,
        scheduleSummary
      });
    }

    // 管理員查詢部門確認進度
    if (type === 'department-progress') {
      if (!['ADMIN', 'HR'].includes(user.role)) {
        return NextResponse.json({ error: '無權限' }, { status: 403 });
      }

      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      // 查詢發布記錄
      const release = await prisma.scheduleMonthlyRelease.findFirst({
        where: {
          yearMonth,
          OR: department 
            ? [{ department }]
            : [{ department: null }]
        },
        include: {
          publishedBy: { select: { name: true } }
        }
      });

      if (!release) {
        return NextResponse.json({
          success: true,
          release: null,
          employees: [],
          stats: { total: 0, confirmed: 0, pending: 0 }
        });
      }

      // 查詢部門員工
      const employees = await prisma.employee.findMany({
        where: {
          isActive: true,
          ...(department ? { department } : {})
        },
        select: {
          id: true,
          employeeId: true,
          name: true,
          department: true
        }
      });

      // 查詢這些員工的確認記錄
      const confirmations = await prisma.scheduleConfirmation.findMany({
        where: {
          releaseId: release.id,
          employeeId: { in: employees.map(e => e.id) }
        }
      });

      const confirmMap = new Map(confirmations.map(c => [c.employeeId, c]));

      const employeeList = employees.map(emp => {
        const conf = confirmMap.get(emp.id);
        const empStatus = getConfirmStatus(release, conf || null);
        
        return {
          id: emp.id,
          employeeId: emp.employeeId,
          name: emp.name,
          department: emp.department,
          status: empStatus,
          confirmedAt: conf?.confirmedAt?.toISOString() || null,
          version: conf?.version || null
        };
      });

      const confirmed = employeeList.filter(e => e.status === 'CONFIRMED').length;
      const pending = employeeList.filter(e => ['PENDING', 'NEED_RECONFIRM', 'EXPIRED'].includes(e.status)).length;

      return NextResponse.json({
        success: true,
        release: {
          id: release.id,
          yearMonth: release.yearMonth,
          publishedAt: release.publishedAt.toISOString(),
          deadline: release.deadline?.toISOString(),
          version: release.version,
          publisherName: release.publishedBy.name
        },
        employees: employeeList,
        stats: {
          total: employeeList.length,
          confirmed,
          pending,
          progress: employeeList.length > 0 ? Math.round((confirmed / employeeList.length) * 100) : 0
        }
      });
    }

    return NextResponse.json({ error: '無效的 type 參數' }, { status: 400 });

  } catch (error) {
    console.error('班表確認查詢錯誤:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/schedule-confirmation');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的班表確認資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的班表確認資料' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action : '';
    const department = typeof body.department === 'string' ? body.department : '';
    const comment = typeof body.comment === 'string' ? body.comment : undefined;
    const rawYearMonth = typeof body.yearMonth === 'string' ? body.yearMonth : null;

    // 員工確認班表
    if (action === 'confirm') {
      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const confirmRateLimitResult = await checkRateLimit(request, '/api/schedule-confirmation/confirm');
      if (!confirmRateLimitResult.allowed) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }

      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, department: true }
      });

      if (!employee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
      }
      
      // 密碼驗證
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password) {
        return NextResponse.json({ error: '請輸入密碼以驗證身份' }, { status: 400 });
      }

      // 取得用戶密碼
      const userRecord = await prisma.user.findFirst({
        where: { employeeId: employee.id },
        select: { passwordHash: true }
      });

      if (!userRecord) {
        return NextResponse.json({ error: '找不到用戶資料' }, { status: 400 });
      }

      // 驗證密碼
      const bcrypt = await import('bcryptjs');
      const isPasswordValid = await bcrypt.compare(password, userRecord.passwordHash);
      
      if (!isPasswordValid) {
        return NextResponse.json({ error: '密碼錯誤，請重新輸入' }, { status: 401 });
      }

      // 查詢已正式發布的記錄
      const release = await prisma.scheduleMonthlyRelease.findFirst({
        where: {
          yearMonth,
          status: 'PUBLISHED',
          OR: [
            { department: null },
            { department: employee.department || '' }
          ]
        },
        orderBy: { publishedAt: 'desc' }
      });

      if (!release) {
        return NextResponse.json({ error: '本月班表尚未發布，無法確認' }, { status: 409 });
      }

      // 建立或更新確認記錄
      const confirmation = await prisma.scheduleConfirmation.upsert({
        where: {
          employeeId_releaseId: {
            employeeId: employee.id,
            releaseId: release.id
          }
        },
        create: {
          employeeId: employee.id,
          yearMonth,
          releaseId: release.id,
          version: release.version,
          confirmedAt: new Date(),
          comment,
          isValid: true
        },
        update: {
          version: release.version,
          confirmedAt: new Date(),
          comment,
          isValid: true
        }
      });

      return NextResponse.json({
        success: true,
        message: '班表確認成功',
        confirmation: {
          id: confirmation.id,
          confirmedAt: confirmation.confirmedAt.toISOString(),
          version: confirmation.version
        }
      });
    }

    // 主管/管理員發布班表
    if (action === 'publish') {
      if (!['ADMIN', 'HR'].includes(user.role)) {
        return NextResponse.json({ error: '無權限發布班表' }, { status: 403 });
      }

      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, department: true }
      });

      if (!employee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
      }

      const deadline = getLastDayOfMonth(yearMonth);

      const targetDepartment = department || null;

      const existingRelease = await prisma.scheduleMonthlyRelease.findFirst({
        where: {
          yearMonth,
          department: targetDepartment
        }
      });

      const release = existingRelease
        ? await prisma.scheduleMonthlyRelease.update({
            where: { id: existingRelease.id },
            data: {
              publishedById: employee.id,
              publishedAt: new Date(),
              deadline,
              status: 'PUBLISHED',
              version: { increment: 1 },
              lastModified: new Date()
            }
          })
        : await prisma.scheduleMonthlyRelease.create({
            data: {
              yearMonth,
              department: targetDepartment,
              publishedById: employee.id,
              publishedAt: new Date(),
              deadline,
              status: 'PUBLISHED',
              version: 1
            }
          });

      // 如果版本更新，將所有確認標記為無效
      if (release.version > 1) {
        await prisma.scheduleConfirmation.updateMany({
          where: { releaseId: release.id },
          data: { isValid: false }
        });
      }

      // 發送通知給相關員工
      const employeesToNotify = await prisma.employee.findMany({
        where: {
          isActive: true,
          ...(department ? { department } : {})
        },
        select: { id: true }
      });
      
      const notifyResult = await sendSchedulePublishNotification(
        yearMonth,
        employeesToNotify.map(e => e.id),
        deadline
      );

      return NextResponse.json({
        success: true,
        message: '班表發布成功',
        release: {
          id: release.id,
          yearMonth: release.yearMonth,
          version: release.version,
          deadline: release.deadline?.toISOString()
        },
        notification: notifyResult
      });
    }

    // 發送提醒給未確認的員工
    if (action === 'send-reminder') {
      if (!['ADMIN', 'HR'].includes(user.role)) {
        return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
      }

      if (!rawYearMonth) {
        return NextResponse.json({ error: '缺少 yearMonth 參數' }, { status: 400 });
      }

      const yearMonthResult = parseYearMonthQueryParam(rawYearMonth);
      if (!yearMonthResult.isValid || yearMonthResult.value === null) {
        return NextResponse.json({ error: 'yearMonth 格式錯誤' }, { status: 400 });
      }

      const yearMonth = yearMonthResult.value;

      const reminderResult = await sendReminderToUnconfirmed(yearMonth, department || undefined);

      return NextResponse.json({
        success: true,
        message: `已發送${reminderResult.sent}則提醒通知`,
        ...reminderResult
      });
    }

    return NextResponse.json({ error: '無效的 action 參數' }, { status: 400 });

  } catch (error) {
    console.error('班表確認操作錯誤:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}
