import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeParseJSON } from '@/lib/validation';
import {
  ensureDefaultShiftDefinitions,
  listShiftDefinitions,
  toShiftDefinitionDTO,
} from '@/lib/shift-definition-service';
import { calculateNetWorkHours } from '@/lib/shift-definition-utils';
import { logSystemSettingsChange } from '@/lib/system-settings-audit';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueConstraintError(error: unknown) {
  if (!isPlainObject(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';

  return code === 'P2002' || message.includes('UNIQUE constraint failed');
}

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}

function parseOptionalBoolean(value: unknown) {
  if (value === undefined) {
    return { success: true as const };
  }

  if (typeof value !== 'boolean') {
    return { success: false as const };
  }

  return { success: true as const, value };
}

function parseOptionalSortOrder(value: unknown) {
  if (value === undefined) {
    return { success: true as const };
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { success: false as const };
  }

  return { success: true as const, value };
}

function parseOptionalBreakTime(value: unknown) {
  if (value === undefined) {
    return { success: true as const };
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1440) {
    return { success: false as const };
  }

  return { success: true as const, value };
}

function parseOptionalHour(value: unknown) {
  if (value === undefined) {
    return { success: true as const };
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24) {
    return { success: false as const };
  }

  return { success: true as const, value: Math.round(value * 100) / 100 };
}

function parseTime(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmedValue)) {
    return null;
  }

  return trimmedValue;
}

function parseShiftPayload(body: Record<string, unknown>, requireCode: boolean) {
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim()
    : null;
  const requiresTimeResult = parseOptionalBoolean(body.requiresTime);
  const breakTimeResult = parseOptionalBreakTime(body.breakTime);
  const workHoursResult = parseOptionalHour(body.workHours);
  const specialLeaveHoursResult = parseOptionalHour(body.specialLeaveHours);
  const compLeaveHoursResult = parseOptionalHour(body.compLeaveHours);
  const overtimeHoursResult = parseOptionalHour(body.overtimeHours);
  const sortOrderResult = parseOptionalSortOrder(body.sortOrder);
  const isActiveResult = parseOptionalBoolean(body.isActive);

  if (requireCode && !code) {
    return { success: false as const, error: '班別代碼為必填' };
  }

  if (code && !/^[A-Za-z0-9_-]{1,12}$/.test(code)) {
    return { success: false as const, error: '班別代碼只能包含英數字、底線或連字號，且長度最多 12 字元' };
  }

  if (!name) {
    return { success: false as const, error: '班別名稱為必填' };
  }

  if (name.length > 50) {
    return { success: false as const, error: '班別名稱最多 50 字元' };
  }

  if (description && description.length > 300) {
    return { success: false as const, error: '班別說明最多 300 字元' };
  }

  if (!requiresTimeResult.success) {
    return { success: false as const, error: '是否需要時間必須是布林值' };
  }

  if (!breakTimeResult.success) {
    return { success: false as const, error: '休息時間需為 0 到 1440 分鐘的整數' };
  }

  if (!workHoursResult.success) {
    return { success: false as const, error: '工時需為 0 到 24 小時' };
  }

  if (!specialLeaveHoursResult.success) {
    return { success: false as const, error: '特休時數需為 0 到 24 小時' };
  }

  if (!compLeaveHoursResult.success) {
    return { success: false as const, error: 'off／補休時數需為 0 到 24 小時' };
  }

  if (!overtimeHoursResult.success) {
    return { success: false as const, error: '加班時數需為 0 到 24 小時' };
  }

  if (!sortOrderResult.success) {
    return { success: false as const, error: '排序需為非負整數' };
  }

  if (!isActiveResult.success) {
    return { success: false as const, error: '啟用狀態必須是布林值' };
  }

  const requiresTime = requiresTimeResult.value ?? true;
  let startTime = '';
  let endTime = '';

  const breakTime = requiresTime ? (breakTimeResult.value ?? 0) : 0;

  if (requiresTime) {
    const parsedStartTime = parseTime(body.startTime);
    const parsedEndTime = parseTime(body.endTime);
    if (!parsedStartTime || !parsedEndTime) {
      return { success: false as const, error: '需要時間的班別必須設定有效的開始與結束時間' };
    }

    startTime = parsedStartTime;
    endTime = parsedEndTime;
  }

  return {
    success: true as const,
    data: {
      ...(code && { code }),
      name,
      startTime,
      endTime,
      breakTime,
      workHours: workHoursResult.value ?? (requiresTime ? calculateNetWorkHours(startTime, endTime, breakTime) : 0),
      specialLeaveHours: specialLeaveHoursResult.value ?? 0,
      compLeaveHours: compLeaveHoursResult.value ?? 0,
      overtimeHours: overtimeHoursResult.value ?? 0,
      requiresTime,
      isActive: isActiveResult.value ?? true,
      sortOrder: sortOrderResult.value ?? 0,
      description,
    },
  };
}

async function requireAdmin(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: '未授權' }, { status: 401 }) };
  }

  if (user.role !== 'ADMIN') {
    return { ok: false as const, response: NextResponse.json({ error: '需要管理員權限' }, { status: 403 }) };
  }

  return { ok: true as const, user };
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/shift-definitions');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await requireAdmin(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const shifts = await listShiftDefinitions({ includeInactive });

    return NextResponse.json({
      success: true,
      shifts,
    });
  } catch (error) {
    console.error('取得班別設定失敗:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/shift-definitions');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const auth = await requireAdmin(request);
    if (!auth.ok) {
      return auth.response;
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的班別設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    if (!isPlainObject(parseResult.data)) {
      return NextResponse.json({ error: '請提供有效的班別設定資料' }, { status: 400 });
    }

    const payload = parseShiftPayload(parseResult.data, true);
    if (!payload.success) {
      return NextResponse.json({ error: payload.error }, { status: 400 });
    }
    const shiftCode = payload.data.code;
    if (!shiftCode) {
      return NextResponse.json({ error: '班別代碼為必填' }, { status: 400 });
    }

    await ensureDefaultShiftDefinitions();

    const existingShifts = await prisma.shiftDefinition.findMany({
      select: { code: true },
    });
    if (existingShifts.some((shift) => shift.code.toLowerCase() === shiftCode.toLowerCase())) {
      return NextResponse.json({ error: '班別代碼已存在' }, { status: 400 });
    }

    const shift = await prisma.shiftDefinition.create({
      data: {
        ...payload.data,
        code: shiftCode,
      },
    });

    await logSystemSettingsChange({
      request,
      user: auth.user,
      settingKey: 'shift-definitions',
      description: '班別定義新增',
      oldValue: null,
      newValue: shift,
      targetId: shift.id,
    });

    return NextResponse.json({
      success: true,
      message: '班別已新增',
      shift: toShiftDefinitionDTO(shift),
    }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: '班別代碼已存在' }, { status: 400 });
    }

    console.error('新增班別設定失敗:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/shift-definitions');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const auth = await requireAdmin(request);
    if (!auth.ok) {
      return auth.response;
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的班別設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    if (!isPlainObject(parseResult.data)) {
      return NextResponse.json({ error: '請提供有效的班別設定資料' }, { status: 400 });
    }

    const id = parsePositiveInteger(parseResult.data.id);
    if (!id) {
      return NextResponse.json({ error: '班別 ID 格式無效' }, { status: 400 });
    }

    const payload = parseShiftPayload(parseResult.data, false);
    if (!payload.success) {
      return NextResponse.json({ error: payload.error }, { status: 400 });
    }
    const updateData = { ...payload.data };
    delete updateData.code;

    const existingShift = await prisma.shiftDefinition.findUnique({
      where: { id },
    });
    if (!existingShift) {
      return NextResponse.json({ error: '找不到班別' }, { status: 404 });
    }

    const shift = await prisma.shiftDefinition.update({
      where: { id },
      data: updateData,
    });

    await logSystemSettingsChange({
      request,
      user: auth.user,
      settingKey: 'shift-definitions',
      description: '班別定義變更',
      oldValue: existingShift,
      newValue: shift,
      targetId: shift.id,
    });

    return NextResponse.json({
      success: true,
      message: '班別已更新',
      shift: toShiftDefinitionDTO(shift),
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: '班別代碼已存在' }, { status: 400 });
    }

    console.error('更新班別設定失敗:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/shift-definitions');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const auth = await requireAdmin(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const id = parsePositiveInteger(searchParams.get('id'));
    if (!id) {
      return NextResponse.json({ error: '班別 ID 格式無效' }, { status: 400 });
    }

    const existingShift = await prisma.shiftDefinition.findUnique({
      where: { id },
    });
    if (!existingShift) {
      return NextResponse.json({ error: '找不到班別' }, { status: 404 });
    }

    const shift = await prisma.shiftDefinition.update({
      where: { id },
      data: { isActive: false },
    });

    await logSystemSettingsChange({
      request,
      user: auth.user,
      settingKey: 'shift-definitions',
      description: '班別定義停用',
      oldValue: existingShift,
      newValue: shift,
      targetId: shift.id,
    });

    return NextResponse.json({
      success: true,
      message: '班別已停用',
      shift: toShiftDefinitionDTO(shift),
    });
  } catch (error) {
    console.error('停用班別設定失敗:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}
