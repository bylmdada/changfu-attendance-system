import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';
import { safeParseJSON } from '@/lib/validation';

interface GPSSettings {
  enabled: boolean;
  requiredAccuracy: number;
  allowOfflineMode: boolean;
  offlineGracePeriod: number;
  maxDistanceVariance: number;
  verificationTimeout: number;
  enableLocationHistory: boolean;
  requireAddressInfo: boolean;
}

// 預設GPS設定
const defaultGPSSettings: GPSSettings = {
  enabled: true,
  requiredAccuracy: 50,
  allowOfflineMode: false,
  offlineGracePeriod: 5,
  maxDistanceVariance: 20,
  verificationTimeout: 30,
  enableLocationHistory: true,
  requireAddressInfo: true
};

const GPS_SETTINGS_KEY = 'gps_settings';
const BOOLEAN_FIELDS = [
  'enabled',
  'allowOfflineMode',
  'enableLocationHistory',
  'requireAddressInfo',
] as const;

function parseBoundedInteger(
  value: unknown,
  fieldName: string,
  options: { min: number; max: number }
): { value?: number; error?: string } {
  if (value === undefined) {
    return {};
  }

  let normalizedValue: number;

  if (typeof value === 'number' && Number.isInteger(value)) {
    normalizedValue = value;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    normalizedValue = Number(value.trim());
  } else {
    return { error: `${fieldName} 格式無效` };
  }

  return {
    value: Math.max(options.min, Math.min(options.max, normalizedValue)),
  };
}

function getBooleanFieldError(input: Record<string, unknown>) {
  for (const field of BOOLEAN_FIELDS) {
    if (field in input && typeof input[field] !== 'boolean') {
      return `${field} 必須為布林值`;
    }
  }

  return undefined;
}

// 從資料庫獲取 GPS 設定
async function getGPSSettingsFromDB(): Promise<GPSSettings> {
  try {
    const setting = await prisma.systemSettings.findUnique({
      where: { key: GPS_SETTINGS_KEY }
    });

    if (setting) {
      return {
        ...defaultGPSSettings,
        ...safeParseSystemSettingsValue<Partial<GPSSettings>>(setting.value, {}, GPS_SETTINGS_KEY),
      };
    }
  } catch (error) {
    console.error('讀取 GPS 設定失敗:', error);
  }

  return { ...defaultGPSSettings };
}

// 保存 GPS 設定到資料庫
async function saveGPSSettingsToDB(settings: GPSSettings): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { key: GPS_SETTINGS_KEY },
    update: {
      value: JSON.stringify(settings),
      updatedAt: new Date()
    },
    create: {
      key: GPS_SETTINGS_KEY,
      value: JSON.stringify(settings)
    }
  });
}

// GET - 獲取GPS設定
export async function GET() {
  try {
    const settings = await getGPSSettingsFromDB();
    
    return NextResponse.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('獲取GPS設定失敗:', error);
    return NextResponse.json(
      { success: false, message: '獲取GPS設定失敗' },
      { status: 500 }
    );
  }
}

// POST - 更新GPS設定
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/gps-attendance');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          success: false,
          message: 'GPS設定變更請求過於頻繁',
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

    const parsedBody = await safeParseJSON(request);

    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, message: '請提供有效的設定資料' },
        { status: 400 }
      );
    }

    const body = parsedBody.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: '請提供有效的設定資料' },
        { status: 400 }
      );
    }
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 10000) {
      return NextResponse.json(
        { success: false, message: '設定資料過大' },
        { status: 400 }
      );
    }
    
    const { settings } = body;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return NextResponse.json(
        { success: false, message: '缺少設定資料' },
        { status: 400 }
      );
    }

    const settingsRecord = settings as Record<string, unknown>;

    const booleanFieldError = getBooleanFieldError(settingsRecord);
    if (booleanFieldError) {
      return NextResponse.json(
        { success: false, message: booleanFieldError },
        { status: 400 }
      );
    }

    const requiredAccuracyResult = parseBoundedInteger(settingsRecord.requiredAccuracy, 'requiredAccuracy', { min: 10, max: 500 });
    if (requiredAccuracyResult.error) {
      return NextResponse.json(
        { success: false, message: requiredAccuracyResult.error },
        { status: 400 }
      );
    }

    const offlineGracePeriodResult = parseBoundedInteger(settingsRecord.offlineGracePeriod, 'offlineGracePeriod', { min: 1, max: 60 });
    if (offlineGracePeriodResult.error) {
      return NextResponse.json(
        { success: false, message: offlineGracePeriodResult.error },
        { status: 400 }
      );
    }

    const maxDistanceVarianceResult = parseBoundedInteger(settingsRecord.maxDistanceVariance, 'maxDistanceVariance', { min: 5, max: 100 });
    if (maxDistanceVarianceResult.error) {
      return NextResponse.json(
        { success: false, message: maxDistanceVarianceResult.error },
        { status: 400 }
      );
    }

    const verificationTimeoutResult = parseBoundedInteger(settingsRecord.verificationTimeout, 'verificationTimeout', { min: 10, max: 120 });
    if (verificationTimeoutResult.error) {
      return NextResponse.json(
        { success: false, message: verificationTimeoutResult.error },
        { status: 400 }
      );
    }

    const existingSettings = await getGPSSettingsFromDB();

    // 驗證設定值
    const validatedSettings: GPSSettings = {
      enabled: typeof settingsRecord.enabled === 'boolean' ? settingsRecord.enabled : existingSettings.enabled,
      requiredAccuracy: requiredAccuracyResult.value === undefined
        ? existingSettings.requiredAccuracy
        : requiredAccuracyResult.value,
      allowOfflineMode: typeof settingsRecord.allowOfflineMode === 'boolean'
        ? settingsRecord.allowOfflineMode
        : existingSettings.allowOfflineMode,
      offlineGracePeriod: offlineGracePeriodResult.value === undefined
        ? existingSettings.offlineGracePeriod
        : offlineGracePeriodResult.value,
      maxDistanceVariance: maxDistanceVarianceResult.value === undefined
        ? existingSettings.maxDistanceVariance
        : maxDistanceVarianceResult.value,
      verificationTimeout: verificationTimeoutResult.value === undefined
        ? existingSettings.verificationTimeout
        : verificationTimeoutResult.value,
      enableLocationHistory: typeof settingsRecord.enableLocationHistory === 'boolean'
        ? settingsRecord.enableLocationHistory
        : existingSettings.enableLocationHistory,
      requireAddressInfo: typeof settingsRecord.requireAddressInfo === 'boolean'
        ? settingsRecord.requireAddressInfo
        : existingSettings.requireAddressInfo
    };

    // 更新設定到資料庫
    await saveGPSSettingsToDB(validatedSettings);

    return NextResponse.json({
      success: true,
      message: 'GPS設定更新成功',
      settings: validatedSettings
    });
  } catch (error) {
    console.error('更新GPS設定失敗:', error);
    return NextResponse.json(
      { success: false, message: '更新GPS設定失敗' },
      { status: 500 }
    );
  }
}

// PUT - 重置為預設設定（需要管理員權限）
export async function PUT(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/gps-attendance');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, message: 'GPS設定變更請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ success: false, message: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    // 管理員權限驗證
    const userAuth = await getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: '需要管理員權限' },
        { status: 403 }
      );
    }

    // 重置為預設值並保存到資料庫
    await saveGPSSettingsToDB({ ...defaultGPSSettings });

    return NextResponse.json({
      success: true,
      message: 'GPS設定已重置為預設值',
      settings: defaultGPSSettings
    });
  } catch (error) {
    console.error('重置GPS設定失敗:', error);
    return NextResponse.json(
      { success: false, message: '重置GPS設定失敗' },
      { status: 500 }
    );
  }
}

// PATCH - 部分更新GPS設定
export async function PATCH(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/gps-attendance');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, message: 'GPS設定變更請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ success: false, message: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    // 管理員權限驗證
    const userAuth = await getUserFromRequest(request);
    if (!userAuth || userAuth.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: '需要管理員權限' },
        { status: 403 }
      );
    }

    const parsedBody = await safeParseJSON(request);

    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, message: '請提供有效的設定資料' },
        { status: 400 }
      );
    }

    const body = parsedBody.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: '請提供有效的設定資料' },
        { status: 400 }
      );
    }

    const updates = body as Record<string, unknown>;

    const booleanFieldError = getBooleanFieldError(updates);
    if (booleanFieldError) {
      return NextResponse.json(
        { success: false, message: booleanFieldError },
        { status: 400 }
      );
    }

    const requiredAccuracyResult = parseBoundedInteger(updates.requiredAccuracy, 'requiredAccuracy', { min: 10, max: 500 });
    if (requiredAccuracyResult.error) {
      return NextResponse.json(
        { success: false, message: requiredAccuracyResult.error },
        { status: 400 }
      );
    }

    const offlineGracePeriodResult = parseBoundedInteger(updates.offlineGracePeriod, 'offlineGracePeriod', { min: 1, max: 60 });
    if (offlineGracePeriodResult.error) {
      return NextResponse.json(
        { success: false, message: offlineGracePeriodResult.error },
        { status: 400 }
      );
    }

    const maxDistanceVarianceResult = parseBoundedInteger(updates.maxDistanceVariance, 'maxDistanceVariance', { min: 5, max: 100 });
    if (maxDistanceVarianceResult.error) {
      return NextResponse.json(
        { success: false, message: maxDistanceVarianceResult.error },
        { status: 400 }
      );
    }

    const verificationTimeoutResult = parseBoundedInteger(updates.verificationTimeout, 'verificationTimeout', { min: 10, max: 120 });
    if (verificationTimeoutResult.error) {
      return NextResponse.json(
        { success: false, message: verificationTimeoutResult.error },
        { status: 400 }
      );
    }

    // 獲取現有設定
    const currentSettings = await getGPSSettingsFromDB();
    const updatedSettings = { ...currentSettings };

    // 只更新提供的欄位
    if (typeof updates.enabled !== 'undefined') {
      updatedSettings.enabled = updates.enabled as boolean;
    }
    if (requiredAccuracyResult.value !== undefined) {
      updatedSettings.requiredAccuracy = requiredAccuracyResult.value;
    }
    if (typeof updates.allowOfflineMode !== 'undefined') {
      updatedSettings.allowOfflineMode = updates.allowOfflineMode as boolean;
    }
    if (offlineGracePeriodResult.value !== undefined) {
      updatedSettings.offlineGracePeriod = offlineGracePeriodResult.value;
    }
    if (maxDistanceVarianceResult.value !== undefined) {
      updatedSettings.maxDistanceVariance = maxDistanceVarianceResult.value;
    }
    if (verificationTimeoutResult.value !== undefined) {
      updatedSettings.verificationTimeout = verificationTimeoutResult.value;
    }
    if (typeof updates.enableLocationHistory !== 'undefined') {
      updatedSettings.enableLocationHistory = updates.enableLocationHistory as boolean;
    }
    if (typeof updates.requireAddressInfo !== 'undefined') {
      updatedSettings.requireAddressInfo = updates.requireAddressInfo as boolean;
    }

    // 保存更新後的設定
    await saveGPSSettingsToDB(updatedSettings);

    return NextResponse.json({
      success: true,
      message: 'GPS設定部分更新成功',
      settings: updatedSettings
    });
  } catch (error) {
    console.error('部分更新GPS設定失敗:', error);
    return NextResponse.json(
      { success: false, message: '部分更新GPS設定失敗' },
      { status: 500 }
    );
  }
}
