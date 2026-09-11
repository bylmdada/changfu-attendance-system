import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { safeParseJSON } from '@/lib/validation';
import {
  DEFAULT_OVERTIME_CALCULATION_SETTINGS,
  OVERTIME_SETTINGS_KEY,
  getStoredOvertimeCalculationSettings,
  type OvertimeCalculationSettings,
} from '@/lib/overtime-settings';
import { logSystemSettingsChange } from '@/lib/system-settings-audit';
import { normalizeOvertimeUnitMinutes } from '@/lib/overtime-hours';

// 從資料庫獲取加班費設定
async function getOvertimeSettingsFromDB(): Promise<OvertimeCalculationSettings> {
  try {
    return await getStoredOvertimeCalculationSettings();
  } catch (error) {
    console.error('讀取加班費設定失敗:', error);
  }

  return { ...DEFAULT_OVERTIME_CALCULATION_SETTINGS };
}

// 保存加班費設定到資料庫
async function saveOvertimeSettingsToDB(settings: OvertimeCalculationSettings): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { key: OVERTIME_SETTINGS_KEY },
    update: {
      value: JSON.stringify(settings),
      updatedAt: new Date()
    },
    create: {
      key: OVERTIME_SETTINGS_KEY,
      value: JSON.stringify(settings),
      description: '加班費計算參數設定'
    }
  });
}

// GET - 獲取加班費設定
export async function GET(request: NextRequest) {
  try {
    const userAuth = await getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: '需要管理員權限' },
        { status: 403 }
      );
    }

    const settings = await getOvertimeSettingsFromDB();
    
    return NextResponse.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('獲取加班費設定失敗:', error);
    return NextResponse.json(
      { success: false, message: '獲取加班費設定失敗' },
      { status: 500 }
    );
  }
}

// POST - 更新加班費設定
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/overtime-calculation');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          success: false,
          message: '加班費設定變更請求過於頻繁',
          retryAfter: rateLimitResult.retryAfter 
        },
        { 
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          }
        }
      );
    }

    // 2. CSRF保護檢查
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { success: false, message: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    // 3. 管理員權限驗證
    const userAuth = await getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: '需要管理員權限' },
        { status: 403 }
      );
    }

    const bodyResult = await safeParseJSON(request);

    if (!bodyResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: bodyResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式'
        },
        { status: 400 }
      );
    }

    const body = bodyResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: '請提供有效的設定資料' },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 10000) {
      return NextResponse.json(
        { success: false, message: '設定資料過大' },
        { status: 400 }
      );
    }

    if (
      input.overtimeMinUnit !== undefined
      && normalizeOvertimeUnitMinutes(input.overtimeMinUnit as number) !== input.overtimeMinUnit
    ) {
      return NextResponse.json(
        { success: false, message: '最低申請時數必須為 1、5、15、30 或 60 分鐘' },
        { status: 400 }
      );
    }

    const existingSettings = await getOvertimeSettingsFromDB();

    // 驗證並清理設定值
    const validatedSettings: OvertimeCalculationSettings = {
      weekdayFirstTwoHoursRate: existingSettings.weekdayFirstTwoHoursRate,
      weekdayAfterTwoHoursRate: existingSettings.weekdayAfterTwoHoursRate,
      restDayFirstTwoHoursRate: existingSettings.restDayFirstTwoHoursRate,
      restDayHours3To8Rate: existingSettings.restDayHours3To8Rate,
      restDayAfterEightHoursRate: existingSettings.restDayAfterEightHoursRate,
      holidayRate: existingSettings.holidayRate,
      mandatoryRestRate: existingSettings.mandatoryRestRate,
      weekdayMaxHours: existingSettings.weekdayMaxHours,
      restDayMaxHours: existingSettings.restDayMaxHours,
      holidayMaxHours: existingSettings.holidayMaxHours,
      mandatoryRestMaxHours: existingSettings.mandatoryRestMaxHours,
      monthlyBasicHours: existingSettings.monthlyBasicHours,
      restDayMinimumPayHours: existingSettings.restDayMinimumPayHours,
      overtimeMinUnit: input.overtimeMinUnit === undefined
        ? existingSettings.overtimeMinUnit
        : input.overtimeMinUnit as number,
      compensationMode: input.compensationMode === 'COMP_LEAVE_ONLY' || input.compensationMode === 'OVERTIME_PAY_ONLY' || input.compensationMode === 'EMPLOYEE_CHOICE'
        ? input.compensationMode
        : existingSettings.compensationMode,
      settleOnResignation: existingSettings.settleOnResignation,
      isEnabled: existingSettings.isEnabled,
      description: typeof input.description === 'string' 
        ? input.description.slice(0, 200) 
        : existingSettings.description
    };

    // 更新設定到資料庫
    await saveOvertimeSettingsToDB(validatedSettings);

    await logSystemSettingsChange({
      request,
      user: userAuth,
      settingKey: OVERTIME_SETTINGS_KEY,
      description: '加班費計算設定變更',
      oldValue: existingSettings,
      newValue: validatedSettings,
    });

    return NextResponse.json({
      success: true,
      message: '加班費設定更新成功',
      settings: validatedSettings
    });
  } catch (error) {
    console.error('更新加班費設定失敗:', error);
    return NextResponse.json(
      { success: false, message: '更新加班費設定失敗' },
      { status: 500 }
    );
  }
}
