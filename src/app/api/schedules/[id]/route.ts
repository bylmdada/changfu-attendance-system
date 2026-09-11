import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import {
  canManageScheduleEmployee,
  hasFullScheduleManagementAccess
} from '@/lib/schedule-management-permissions';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { buildScheduleFieldsFromShiftDefinition } from '@/lib/shift-definition-service';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';
import { isScheduleHourConsistent } from '@/lib/shift-definition-utils';
import { checkAttendanceFreeze, getAttendanceFreezeError } from '@/lib/attendance-freeze';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHour(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

// GET: 取得單一排程
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    const scheduleIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

    if (!scheduleIdResult.isValid || scheduleIdResult.value === null) {
      return NextResponse.json({ error: 'Invalid schedule ID' }, { status: 400 });
    }
    const scheduleId = scheduleIdResult.value;

    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
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

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    const hasFullAccess = hasFullScheduleManagementAccess(user);
    const canManage = await canManageScheduleEmployee(user, schedule.employeeId);

    if (!hasFullAccess && schedule.employeeId !== user.employeeId && !canManage) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      schedule: {
        id: schedule.id,
        employeeId: schedule.employee.employeeId,
        employeeName: schedule.employee.name,
        department: schedule.employee.department,
        date: schedule.workDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        breakTime: schedule.breakTime,
        workHours: schedule.workHours,
        specialLeaveHours: schedule.specialLeaveHours,
        compLeaveHours: schedule.compLeaveHours,
        overtimeHours: schedule.overtimeHours,
        shiftType: schedule.shiftType,
        status: 'active',
        employee: schedule.employee
      }
    });
  } catch (error) {
    console.error('取得排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// PUT: 更新單一排程
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const scheduleIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

    if (!scheduleIdResult.isValid || scheduleIdResult.value === null) {
      return NextResponse.json({ error: 'Invalid schedule ID' }, { status: 400 });
    }
    const scheduleId = scheduleIdResult.value;

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

    const startTime = typeof body.startTime === 'string' ? body.startTime : undefined;
    const endTime = typeof body.endTime === 'string' ? body.endTime : undefined;
    const shiftType = typeof body.shiftType === 'string' ? body.shiftType : undefined;
    const workDate = typeof body.workDate === 'string' ? body.workDate : undefined;
    const breakTime = typeof body.breakTime === 'number' ? body.breakTime : undefined;
    const workHours = parseHour(body.workHours);
    const specialLeaveHours = parseHour(body.specialLeaveHours);
    const compLeaveHours = parseHour(body.compLeaveHours);
    const overtimeHours = parseHour(body.overtimeHours);

    const updatedScheduleResult = await prisma.$transaction(async (tx) => {
      const scheduleToUpdate = await tx.schedule.findUnique({
        where: { id: scheduleId },
        select: {
          employeeId: true,
          workDate: true,
          shiftType: true,
          startTime: true,
          endTime: true,
          breakTime: true,
          workHours: true,
        }
      });

      if (!scheduleToUpdate) {
        return {
          ok: false as const,
          status: 404,
          body: { error: '找不到排程' }
        };
      }

      const freezeError = getAttendanceFreezeError(
        await checkAttendanceFreeze(new Date(`${scheduleToUpdate.workDate}T00:00:00+08:00`))
      );
      if (freezeError) {
        return { ok: false as const, status: 409, body: { error: freezeError } };
      }

      const canManage = await canManageScheduleEmployee(user, scheduleToUpdate.employeeId, new Date(), tx);
      if (!canManage) {
        return {
          ok: false as const,
          status: 403,
          body: { error: '無權限管理該員工的排程' }
        };
      }

      const updateData: {
        startTime?: string;
        endTime?: string;
        shiftType?: string;
        workDate?: string;
        breakTime?: number;
        workHours?: number;
        specialLeaveHours?: number;
        compLeaveHours?: number;
        overtimeHours?: number;
      } = {};

      if (workDate) {
        updateData.workDate = workDate;
      }

      const shiftTypeChanged = shiftType !== undefined && shiftType !== scheduleToUpdate.shiftType;
      const shiftDefinition = shiftTypeChanged
        ? await tx.shiftDefinition.findFirst({ where: { code: shiftType, isActive: true } })
        : null;

      if (shiftTypeChanged && !shiftDefinition) {
        return {
          ok: false as const,
          status: 400,
          body: { success: false, error: '班別不存在或已停用，請先至班別設定確認' }
        };
      }

      if (shiftDefinition) {
        Object.assign(updateData, buildScheduleFieldsFromShiftDefinition(shiftDefinition));
      } else if (shiftType !== undefined) {
        updateData.shiftType = shiftType;
      }

      if (startTime !== undefined) {
        updateData.startTime = startTime;
      }
      if (endTime !== undefined) {
        updateData.endTime = endTime;
      }
      if (breakTime !== undefined) {
        updateData.breakTime = breakTime;
      }
      if (workHours !== undefined) {
        updateData.workHours = workHours;
      }
      if (specialLeaveHours !== undefined) {
        updateData.specialLeaveHours = specialLeaveHours;
      }
      if (compLeaveHours !== undefined) {
        updateData.compLeaveHours = compLeaveHours;
      }
      if (overtimeHours !== undefined) {
        updateData.overtimeHours = overtimeHours;
      }

      const nextSchedule = { ...scheduleToUpdate, ...updateData };
      const manuallyChangedHours = startTime !== undefined || endTime !== undefined || breakTime !== undefined || workHours !== undefined;
      if (
        manuallyChangedHours
        && !isScheduleHourConsistent(
          nextSchedule.startTime,
          nextSchedule.endTime,
          nextSchedule.breakTime,
          nextSchedule.workHours
        )
      ) {
        return {
          ok: false as const,
          status: 400,
          body: { success: false, error: '工時與上下班時間、休息時間不一致' }
        };
      }

      const schedule = await tx.schedule.update({
        where: { id: scheduleId },
        data: updateData,
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

    // 觸發重新確認機制
    await invalidateConfirmation(updatedScheduleResult.schedule.employeeId, updatedScheduleResult.schedule.workDate.slice(0, 7));

    return NextResponse.json({
      success: true,
      message: '排程更新成功',
      schedule: {
        id: updatedScheduleResult.schedule.id,
        employeeId: updatedScheduleResult.schedule.employee.employeeId,
        employeeName: updatedScheduleResult.schedule.employee.name,
        department: updatedScheduleResult.schedule.employee.department,
        date: updatedScheduleResult.schedule.workDate,
        startTime: updatedScheduleResult.schedule.startTime,
        endTime: updatedScheduleResult.schedule.endTime,
        breakTime: updatedScheduleResult.schedule.breakTime,
        workHours: updatedScheduleResult.schedule.workHours,
        specialLeaveHours: updatedScheduleResult.schedule.specialLeaveHours,
        compLeaveHours: updatedScheduleResult.schedule.compLeaveHours,
        overtimeHours: updatedScheduleResult.schedule.overtimeHours,
        shiftType: updatedScheduleResult.schedule.shiftType
      }
    });
  } catch (error) {
    console.error('更新排程失敗:', error);
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// DELETE: 刪除單一排程
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const scheduleIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

    if (!scheduleIdResult.isValid || scheduleIdResult.value === null) {
      return NextResponse.json({ error: 'Invalid schedule ID' }, { status: 400 });
    }
    const scheduleId = scheduleIdResult.value;

    const deletedScheduleResult = await prisma.$transaction(async (tx) => {
      const scheduleToDelete = await tx.schedule.findUnique({
        where: { id: scheduleId },
        select: { employeeId: true, workDate: true }
      });

      if (!scheduleToDelete) {
        return {
          ok: false as const,
          status: 404,
          body: { error: '找不到排程' }
        };
      }

      const freezeError = getAttendanceFreezeError(
        await checkAttendanceFreeze(new Date(`${scheduleToDelete.workDate}T00:00:00+08:00`))
      );
      if (freezeError) {
        return { ok: false as const, status: 409, body: { error: freezeError } };
      }

      const canManage = await canManageScheduleEmployee(user, scheduleToDelete.employeeId, new Date(), tx);
      if (!canManage) {
        return {
          ok: false as const,
          status: 403,
          body: { error: '無權限管理該員工的排程' }
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

    // 觸發重新確認機制
    await invalidateConfirmation(deletedScheduleResult.schedule.employeeId, deletedScheduleResult.schedule.workDate.slice(0, 7));

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
