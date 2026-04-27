import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';
import {
  canManageScheduleEmployee,
  getManageableDepartments,
  hasFullScheduleManagementAccess
} from '@/lib/schedule-management-permissions';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// GET: 取得排程列表
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Authentication check
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const department = searchParams.get('department');
    const employeeId = searchParams.get('employeeId');

    // 構建查詢條件
    const where: Record<string, unknown> = {};

    // 日期篩選
    if (date) {
      where.workDate = date;
    } else if (year && month) {
      const yearResult = parseIntegerQueryParam(year, { min: 1900, max: 9999 });
      const monthResult = parseIntegerQueryParam(month, { min: 1, max: 12 });
      if (!yearResult.isValid || yearResult.value === null || !monthResult.isValid || monthResult.value === null) {
        return NextResponse.json({ success: false, error: 'year/month 格式錯誤' }, { status: 400 });
      }
      const monthNumber = monthResult.value;
      const paddedMonth = String(monthNumber).padStart(2, '0');
      const lastDay = new Date(yearResult.value, monthNumber, 0).getDate();
      where.workDate = {
        gte: `${yearResult.value}-${paddedMonth}-01`,
        lte: `${yearResult.value}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`
      };
    } else if (startDate || endDate) {
      where.workDate = {};
      if (startDate) {
        (where.workDate as Record<string, string>).gte = startDate;
      }
      if (endDate) {
        (where.workDate as Record<string, string>).lte = endDate;
      }
    }

    const employeeWhere: Record<string, unknown> = {};

    // 部門篩選
    if (department) {
      employeeWhere.department = department;
    }

    // 員工篩選
    if (employeeId) {
      const employeeIdResult = parseIntegerQueryParam(employeeId, { min: 1, max: 99999999 });
      if (!employeeIdResult.isValid || employeeIdResult.value === null) {
        return NextResponse.json({ success: false, error: 'employeeId 格式錯誤' }, { status: 400 });
      }
      where.employeeId = employeeIdResult.value;
    }

    // 權限檢查：部門主管或授權員工可查看可管理的部門
    const isFullAdmin = hasFullScheduleManagementAccess(user);
    const manageableDepartments = await getManageableDepartments(user);
    
    // 非管理員且無管理權限，只能查看自己的班表
    if (!isFullAdmin && manageableDepartments.length === 0) {
      where.employeeId = user.employeeId;
    } else if (!isFullAdmin && manageableDepartments.length > 0) {
      // 有管理權限，可查看可管理部門的員工
      employeeWhere.department = { in: manageableDepartments };
    }

    if (Object.keys(employeeWhere).length > 0) {
      where.employee = { is: employeeWhere };
    }

    // 查詢班表
    const schedules = await prisma.schedule.findMany({
      where,
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
      },
      orderBy: [
        { workDate: 'asc' },
        { startTime: 'asc' }
      ]
    });

    // 格式化輸出
    const formattedSchedules = schedules.map(s => ({
      id: s.id,
      employeeId: s.employeeId,
      employeeCode: s.employee.employeeId,
      employeeName: s.employee.name,
      department: s.employee.department,
      workDate: s.workDate,
      date: s.workDate,
      startTime: s.startTime,
      endTime: s.endTime,
      breakTime: s.breakTime,
      shiftType: s.shiftType,
      status: 'active',
      employee: s.employee
    }));

    return NextResponse.json({
      success: true,
      schedules: formattedSchedules,
      total: formattedSchedules.length
    });
  } catch (error) {
    console.error('取得排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// POST: 新增排程
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    // 權限檢查：部門主管或授權員工可新增可管理部門的排程
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error === 'empty_body' ? '請提供有效的排程資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { success: false, error: '請提供有效的排程資料' },
        { status: 400 }
      );
    }

    const employeeId = typeof body.employeeId === 'string' || typeof body.employeeId === 'number'
      ? body.employeeId
      : undefined;
    const date = typeof body.date === 'string' ? body.date : undefined;
    const workDate = typeof body.workDate === 'string' ? body.workDate : undefined;
    const startTime = typeof body.startTime === 'string' ? body.startTime : undefined;
    const endTime = typeof body.endTime === 'string' ? body.endTime : undefined;
    const shiftType = typeof body.shiftType === 'string' ? body.shiftType : 'normal';
    const breakTime = typeof body.breakTime === 'number' ? body.breakTime : undefined;
    const scheduleDate = date || workDate; // 支援 date 和 workDate 兩種欄位名

    // 休假類型不需要時間
    const noTimeShiftTypes = ['NH', 'RD', 'rd', 'OFF', 'FDL', 'TD'];
    const requiresTime = !noTimeShiftTypes.includes(shiftType);

    if (!employeeId || !scheduleDate) {
      return NextResponse.json(
        { success: false, error: '員工ID和日期為必填項目' },
        { status: 400 }
      );
    }

    if (requiresTime && (!startTime || !endTime)) {
      return NextResponse.json(
        { success: false, error: '此班別類型需要填寫開始時間和結束時間' },
        { status: 400 }
      );
    }

    const rawNumericEmployeeId = typeof employeeId === 'number' ? String(employeeId) : typeof employeeId === 'string' ? employeeId : null;
    const numericEmployeeIdResult = rawNumericEmployeeId !== null
      ? parseIntegerQueryParam(rawNumericEmployeeId, { min: 1, max: 99999999 })
      : { value: null, isValid: false };
    const createdScheduleResult = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: {
          OR: [
            { id: numericEmployeeIdResult.isValid ? numericEmployeeIdResult.value ?? undefined : undefined },
            { employeeId: typeof employeeId === 'string' ? employeeId : undefined }
          ]
        }
      });

      if (!employee) {
        return {
          ok: false as const,
          status: 404,
          body: { success: false, error: '找不到該員工' }
        };
      }

      const existingSchedule = await tx.schedule.findUnique({
        where: {
          employeeId_workDate: {
            employeeId: employee.id,
            workDate: scheduleDate
          }
        }
      });

      if (existingSchedule) {
        return {
          ok: false as const,
          status: 400,
          body: { success: false, error: '該員工在此日期已有排程' }
        };
      }

      const canManage = await canManageScheduleEmployee(user, employee.id, new Date(), tx);
      if (!canManage) {
        return {
          ok: false as const,
          status: 403,
          body: { error: '無權限管理該員工的排程' }
        };
      }

      const schedule = await tx.schedule.create({
        data: {
          employeeId: employee.id,
          workDate: scheduleDate,
          startTime: startTime || '',
          endTime: endTime || '',
          shiftType,
          breakTime: breakTime ?? 0
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

      return {
        ok: true as const,
        employeeId: employee.id,
        schedule
      };
    });

    if (!createdScheduleResult.ok) {
      return NextResponse.json(createdScheduleResult.body, { status: createdScheduleResult.status });
    }

    // 觸發班表確認失效（新增班表後需重新確認）
    const yearMonth = scheduleDate.substring(0, 7); // 取得 YYYY-MM
    await invalidateConfirmation(createdScheduleResult.employeeId, yearMonth);

    return NextResponse.json({
      success: true,
      message: '排程新增成功',
      schedule: {
        id: createdScheduleResult.schedule.id,
        employeeId: createdScheduleResult.schedule.employee.employeeId,
        employeeName: createdScheduleResult.schedule.employee.name,
        department: createdScheduleResult.schedule.employee.department,
        date: createdScheduleResult.schedule.workDate,
        startTime: createdScheduleResult.schedule.startTime,
        endTime: createdScheduleResult.schedule.endTime,
        breakTime: createdScheduleResult.schedule.breakTime,
        shiftType: createdScheduleResult.schedule.shiftType,
        status: 'active'
      }
    }, { status: 201 });
  } catch (error) {
    console.error('新增排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// PUT: 更新排程
export async function PUT(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error === 'empty_body' ? '請提供有效的排程資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { success: false, error: '請提供有效的排程資料' },
        { status: 400 }
      );
    }

    const id = typeof body.id === 'string' || typeof body.id === 'number' ? body.id : undefined;
    const startTime = typeof body.startTime === 'string' ? body.startTime : undefined;
    const endTime = typeof body.endTime === 'string' ? body.endTime : undefined;
    const shiftType = typeof body.shiftType === 'string' ? body.shiftType : undefined;
    const breakTime = typeof body.breakTime === 'number' ? body.breakTime : undefined;

    if (!id) {
      return NextResponse.json(
        { success: false, error: '排程ID為必填' },
        { status: 400 }
      );
    }

    const scheduleIdResult = parseIntegerQueryParam(String(id), { min: 1, max: 99999999 });
    if (!scheduleIdResult.isValid || scheduleIdResult.value === null) {
      return NextResponse.json(
        { success: false, error: '排程ID格式錯誤' },
        { status: 400 }
      );
    }
    const scheduleId = scheduleIdResult.value;

    const updatedScheduleResult = await prisma.$transaction(async (tx) => {
      const existingSchedule = await tx.schedule.findUnique({
        where: { id: scheduleId },
        include: { employee: { select: { id: true, department: true } } }
      });

      if (!existingSchedule) {
        return {
          ok: false as const,
          status: 404,
          body: { success: false, error: '找不到排程' }
        };
      }

      const canManage = await canManageScheduleEmployee(user, existingSchedule.employeeId, new Date(), tx);
      if (!canManage) {
        return {
          ok: false as const,
          status: 403,
          body: { error: '無權限管理該員工的排程' }
        };
      }

      const schedule = await tx.schedule.update({
        where: { id: scheduleId },
        data: {
          ...(startTime && { startTime }),
          ...(endTime && { endTime }),
          ...(shiftType && { shiftType }),
          ...(breakTime !== undefined && { breakTime })
        },
        include: {
          employee: {
            select: {
              employeeId: true,
              name: true,
              department: true
            }
          }
        }
      });

      return {
        ok: true as const,
        schedule
      };
    });

    if (!updatedScheduleResult.ok) {
      return NextResponse.json(updatedScheduleResult.body, { status: updatedScheduleResult.status });
    }

    // 觸發班表確認失效
    const yearMonth = updatedScheduleResult.schedule.workDate.substring(0, 7);
    await invalidateConfirmation(updatedScheduleResult.schedule.employeeId, yearMonth);

    return NextResponse.json({
      success: true,
      message: '排程更新成功',
      schedule: updatedScheduleResult.schedule
    });
  } catch (error) {
    console.error('更新排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// DELETE: 刪除排程
export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '排程ID為必填' },
        { status: 400 }
      );
    }

    const scheduleIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!scheduleIdResult.isValid || scheduleIdResult.value === null) {
      return NextResponse.json(
        { success: false, error: '排程ID格式錯誤' },
        { status: 400 }
      );
    }
    const scheduleId = scheduleIdResult.value;

    const deletedScheduleResult = await prisma.$transaction(async (tx) => {
      const scheduleToDelete = await tx.schedule.findUnique({
        where: { id: scheduleId },
        include: { employee: { select: { id: true, department: true } } }
      });

      if (!scheduleToDelete) {
        return {
          ok: false as const,
          status: 404,
          body: { success: false, error: '找不到該排程' }
        };
      }

      const canManage = await canManageScheduleEmployee(user, scheduleToDelete.employeeId, new Date(), tx);
      if (!canManage) {
        return {
          ok: false as const,
          status: 403,
          body: { error: '無權限刪除該員工的排程' }
        };
      }

      await tx.schedule.delete({
        where: { id: scheduleId }
      });

      return {
        ok: true as const,
        schedule: scheduleToDelete
      };
    });

    if (!deletedScheduleResult.ok) {
      return NextResponse.json(deletedScheduleResult.body, { status: deletedScheduleResult.status });
    }

    // 觸發班表確認失效
    const yearMonth = deletedScheduleResult.schedule.workDate.substring(0, 7);
    await invalidateConfirmation(deletedScheduleResult.schedule.employeeId, yearMonth);

    return NextResponse.json({
      success: true,
      message: '排程刪除成功'
    });
  } catch (error) {
    console.error('刪除排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}
