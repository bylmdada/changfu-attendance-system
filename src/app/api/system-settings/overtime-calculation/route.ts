import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';

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
      const parsed = JSON.parse(setting.value);
      // 確保所有欄位都存在（向後相容）
      return {
        ...defaultOvertimeSettings,
        ...parsed
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
export async function GET() {
  try {
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
    const userAuth = getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: '需要管理員權限' },
        { status: 403 }
      );
    }

    const body = await request.json();
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 10000) {
      return NextResponse.json(
        { success: false, message: '設定資料過大' },
        { status: 400 }
      );
    }

    // 驗證並清理設定值
    const validatedSettings: OvertimeCalculationSettings = {
      weekdayFirstTwoHoursRate: Math.max(1, Math.min(3, parseFloat(body.weekdayFirstTwoHoursRate) || 1.34)),
      weekdayAfterTwoHoursRate: Math.max(1, Math.min(3, parseFloat(body.weekdayAfterTwoHoursRate) || 1.67)),
      restDayFirstEightHoursRate: Math.max(1, Math.min(3, parseFloat(body.restDayFirstEightHoursRate) || 1.34)),
      restDayAfterEightHoursRate: Math.max(1, Math.min(3, parseFloat(body.restDayAfterEightHoursRate) || 1.67)),
      holidayRate: Math.max(1, Math.min(3, parseFloat(body.holidayRate) || 2.0)),
      mandatoryRestRate: Math.max(1, Math.min(3, parseFloat(body.mandatoryRestRate) || 2.0)),
      weekdayMaxHours: Math.max(1, Math.min(12, parseInt(body.weekdayMaxHours) || 4)),
      restDayMaxHours: Math.max(8, Math.min(16, parseInt(body.restDayMaxHours) || 12)),
      holidayMaxHours: Math.max(4, Math.min(12, parseInt(body.holidayMaxHours) || 8)),
      mandatoryRestMaxHours: Math.max(4, Math.min(12, parseInt(body.mandatoryRestMaxHours) || 8)),
      monthlyBasicHours: Math.max(160, Math.min(280, parseInt(body.monthlyBasicHours) || 240)),
      restDayMinimumPayHours: Math.max(2, Math.min(8, parseInt(body.restDayMinimumPayHours) || 4)),
      overtimeMinUnit: [1, 5, 15, 30, 60].includes(parseInt(body.overtimeMinUnit)) 
        ? parseInt(body.overtimeMinUnit) 
        : 30,
      compensationMode: ['COMP_LEAVE_ONLY', 'OVERTIME_PAY_ONLY', 'EMPLOYEE_CHOICE'].includes(body.compensationMode)
        ? body.compensationMode
        : 'COMP_LEAVE_ONLY',
      settleOnResignation: Boolean(body.settleOnResignation),
      isEnabled: Boolean(body.isEnabled),
      description: typeof body.description === 'string' 
        ? body.description.slice(0, 200) 
        : defaultOvertimeSettings.description
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
