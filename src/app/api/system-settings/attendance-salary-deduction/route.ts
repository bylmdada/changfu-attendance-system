import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import {
  ATTENDANCE_SALARY_DEDUCTION_SETTINGS_KEY,
  DEFAULT_ATTENDANCE_SALARY_DEDUCTION_SETTINGS,
  getStoredAttendanceSalaryDeductionSettings,
  normalizeAttendanceSalaryDeductionSettings,
  type AttendanceSalaryDeductionSettings,
} from '@/lib/attendance-salary-deduction-settings';
import { logSystemSettingsChange } from '@/lib/system-settings-audit';

async function verifyAdmin(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== 'ADMIN') {
    return null;
  }

  return user;
}

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ success: false, message: '需要管理員權限' }, { status: 403 });
    }

    const settings = await getStoredAttendanceSalaryDeductionSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('取得出勤扣薪設定失敗:', error);
    return NextResponse.json({ success: false, message: '取得出勤扣薪設定失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/attendance-salary-deduction');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: '出勤扣薪設定變更請求過於頻繁',
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60',
          },
        }
      );
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { success: false, message: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ success: false, message: '需要管理員權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: parseResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式',
        },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: '請提供有效的設定資料' },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;
    const existingSettings = await getStoredAttendanceSalaryDeductionSettings();
    const validatedSettings: AttendanceSalaryDeductionSettings = normalizeAttendanceSalaryDeductionSettings({
      ...existingSettings,
      enabled:
        typeof input.enabled === 'boolean'
          ? input.enabled
          : existingSettings.enabled,
      description:
        typeof input.description === 'string'
          ? input.description
          : existingSettings.description,
    });

    await prisma.systemSettings.upsert({
      where: { key: ATTENDANCE_SALARY_DEDUCTION_SETTINGS_KEY },
      update: {
        value: JSON.stringify(validatedSettings),
        updatedAt: new Date(),
      },
      create: {
        key: ATTENDANCE_SALARY_DEDUCTION_SETTINGS_KEY,
        value: JSON.stringify(validatedSettings),
        description: DEFAULT_ATTENDANCE_SALARY_DEDUCTION_SETTINGS.description,
      },
    });

    await logSystemSettingsChange({
      request,
      user,
      settingKey: ATTENDANCE_SALARY_DEDUCTION_SETTINGS_KEY,
      description: '出勤扣薪控管設定變更',
      oldValue: existingSettings,
      newValue: validatedSettings,
    });

    return NextResponse.json({
      success: true,
      message: '出勤扣薪控管設定已儲存',
      settings: validatedSettings,
    });
  } catch (error) {
    console.error('更新出勤扣薪設定失敗:', error);
    return NextResponse.json({ success: false, message: '更新出勤扣薪設定失敗' }, { status: 500 });
  }
}
