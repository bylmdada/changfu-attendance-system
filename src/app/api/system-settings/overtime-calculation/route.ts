import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { safeParseJSON } from '@/lib/validation';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

interface OvertimeCalculationSettings {
  weekdayFirstTwoHoursRate: number;
  weekdayAfterTwoHoursRate: number;
  restDayFirstEightHoursRate: number;
  restDayAfterEightHoursRate: number;
  holidayRate: number;
  mandatoryRestRate: number;
  weekdayMaxHours: number;
  restDayMaxHours: number;
  holidayMaxHours: number;
  mandatoryRestMaxHours: number;
  monthlyBasicHours: number;
  restDayMinimumPayHours: number;
  overtimeMinUnit: number; // 加班最小單位（分鐘）
  compensationMode: 'COMP_LEAVE_ONLY' | 'OVERTIME_PAY_ONLY' | 'EMPLOYEE_CHOICE'; // 加班補償模式
  settleOnResignation: boolean; // 離職時結算補休為金錢
  isEnabled: boolean;
  description: string;
}

// 預設加班費設定
const defaultOvertimeSettings: OvertimeCalculationSettings = {
  weekdayFirstTwoHoursRate: 1.34,
  weekdayAfterTwoHoursRate: 1.67,
  restDayFirstEightHoursRate: 1.34,
  restDayAfterEightHoursRate: 1.67,
  holidayRate: 2.0,
  mandatoryRestRate: 2.0,
  weekdayMaxHours: 4,
  restDayMaxHours: 12,
  holidayMaxHours: 8,
  mandatoryRestMaxHours: 8,
  monthlyBasicHours: 240,
  restDayMinimumPayHours: 4,
  overtimeMinUnit: 30,
  compensationMode: 'COMP_LEAVE_ONLY',
  settleOnResignation: true,
  isEnabled: true,
  description: '依據勞動基準法設定之加班費計算倍率'
};

const OVERTIME_SETTINGS_KEY = 'overtime_calculation_settings';

// 從資料庫獲取加班費設定
async function getOvertimeSettingsFromDB(): Promise<OvertimeCalculationSettings> {
  try {
    const setting = await prisma.systemSettings.findUnique({
      where: { key: OVERTIME_SETTINGS_KEY }
    });

    if (setting) {
      // 確保所有欄位都存在（向後相容）
      return {
        ...defaultOvertimeSettings,
        ...safeParseSystemSettingsValue<Partial<OvertimeCalculationSettings>>(
          setting.value,
          {},
          OVERTIME_SETTINGS_KEY
        )
      };
    }
  } catch (error) {
    console.error('讀取加班費設定失敗:', error);
  }

  return { ...defaultOvertimeSettings };
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

    const clampRate = (value: unknown, fallback: number) =>
      Math.max(1, Math.min(3, Number.parseFloat(String(value)) || fallback));

    const clampHours = (value: unknown, fallback: number, min: number, max: number) =>
      Math.max(min, Math.min(max, Number.parseInt(String(value), 10) || fallback));

    const parseAllowedInt = (value: unknown, fallback: number, allowedValues: number[]) => {
      const parsedValue = Number.parseInt(String(value), 10);
      return allowedValues.includes(parsedValue) ? parsedValue : fallback;
    };
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 10000) {
      return NextResponse.json(
        { success: false, message: '設定資料過大' },
        { status: 400 }
      );
    }

    const existingSettings = await getOvertimeSettingsFromDB();

    // 驗證並清理設定值
    const validatedSettings: OvertimeCalculationSettings = {
      weekdayFirstTwoHoursRate: input.weekdayFirstTwoHoursRate === undefined
        ? existingSettings.weekdayFirstTwoHoursRate
        : clampRate(input.weekdayFirstTwoHoursRate, existingSettings.weekdayFirstTwoHoursRate),
      weekdayAfterTwoHoursRate: input.weekdayAfterTwoHoursRate === undefined
        ? existingSettings.weekdayAfterTwoHoursRate
        : clampRate(input.weekdayAfterTwoHoursRate, existingSettings.weekdayAfterTwoHoursRate),
      restDayFirstEightHoursRate: input.restDayFirstEightHoursRate === undefined
        ? existingSettings.restDayFirstEightHoursRate
        : clampRate(input.restDayFirstEightHoursRate, existingSettings.restDayFirstEightHoursRate),
      restDayAfterEightHoursRate: input.restDayAfterEightHoursRate === undefined
        ? existingSettings.restDayAfterEightHoursRate
        : clampRate(input.restDayAfterEightHoursRate, existingSettings.restDayAfterEightHoursRate),
      holidayRate: input.holidayRate === undefined
        ? existingSettings.holidayRate
        : clampRate(input.holidayRate, existingSettings.holidayRate),
      mandatoryRestRate: input.mandatoryRestRate === undefined
        ? existingSettings.mandatoryRestRate
        : clampRate(input.mandatoryRestRate, existingSettings.mandatoryRestRate),
      weekdayMaxHours: input.weekdayMaxHours === undefined
        ? existingSettings.weekdayMaxHours
        : clampHours(input.weekdayMaxHours, existingSettings.weekdayMaxHours, 1, 12),
      restDayMaxHours: input.restDayMaxHours === undefined
        ? existingSettings.restDayMaxHours
        : clampHours(input.restDayMaxHours, existingSettings.restDayMaxHours, 8, 16),
      holidayMaxHours: input.holidayMaxHours === undefined
        ? existingSettings.holidayMaxHours
        : clampHours(input.holidayMaxHours, existingSettings.holidayMaxHours, 4, 12),
      mandatoryRestMaxHours: input.mandatoryRestMaxHours === undefined
        ? existingSettings.mandatoryRestMaxHours
        : clampHours(input.mandatoryRestMaxHours, existingSettings.mandatoryRestMaxHours, 4, 12),
      monthlyBasicHours: input.monthlyBasicHours === undefined
        ? existingSettings.monthlyBasicHours
        : clampHours(input.monthlyBasicHours, existingSettings.monthlyBasicHours, 160, 280),
      restDayMinimumPayHours: input.restDayMinimumPayHours === undefined
        ? existingSettings.restDayMinimumPayHours
        : clampHours(input.restDayMinimumPayHours, existingSettings.restDayMinimumPayHours, 2, 8),
      overtimeMinUnit: input.overtimeMinUnit === undefined
        ? existingSettings.overtimeMinUnit
        : parseAllowedInt(input.overtimeMinUnit, existingSettings.overtimeMinUnit, [1, 5, 15, 30, 60]),
      compensationMode: input.compensationMode === 'COMP_LEAVE_ONLY' || input.compensationMode === 'OVERTIME_PAY_ONLY' || input.compensationMode === 'EMPLOYEE_CHOICE'
        ? input.compensationMode
        : existingSettings.compensationMode,
      settleOnResignation: typeof input.settleOnResignation === 'boolean'
        ? input.settleOnResignation
        : existingSettings.settleOnResignation,
      isEnabled: typeof input.isEnabled === 'boolean'
        ? input.isEnabled
        : existingSettings.isEnabled,
      description: typeof input.description === 'string' 
        ? input.description.slice(0, 200) 
        : existingSettings.description
    };

    // 更新設定到資料庫
    await saveOvertimeSettingsToDB(validatedSettings);

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
