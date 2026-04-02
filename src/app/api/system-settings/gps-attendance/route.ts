import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';

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

// 從資料庫獲取 GPS 設定
async function getGPSSettingsFromDB(): Promise<GPSSettings> {
  try {
    const setting = await prisma.systemSettings.findUnique({
      where: { key: GPS_SETTINGS_KEY }
    });

    if (setting) {
      return JSON.parse(setting.value) as GPSSettings;
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

    const body = await request.json();
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 10000) {
      return NextResponse.json(
        { success: false, message: '設定資料過大' },
        { status: 400 }
      );
    }
    
    const { settings } = body;

    if (!settings) {
      return NextResponse.json(
        { success: false, message: '缺少設定資料' },
        { status: 400 }
      );
    }

    // 驗證設定值
    const validatedSettings: GPSSettings = {
      enabled: Boolean(settings.enabled),
      requiredAccuracy: Math.max(10, Math.min(500, parseInt(settings.requiredAccuracy) || 50)),
      allowOfflineMode: Boolean(settings.allowOfflineMode),
      offlineGracePeriod: Math.max(1, Math.min(60, parseInt(settings.offlineGracePeriod) || 5)),
      maxDistanceVariance: Math.max(5, Math.min(100, parseInt(settings.maxDistanceVariance) || 20)),
      verificationTimeout: Math.max(10, Math.min(120, parseInt(settings.verificationTimeout) || 30)),
      enableLocationHistory: Boolean(settings.enableLocationHistory),
      requireAddressInfo: Boolean(settings.requireAddressInfo)
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

    const body = await request.json();
    const updates = body;

    // 獲取現有設定
    const currentSettings = await getGPSSettingsFromDB();
    const updatedSettings = { ...currentSettings };

    // 只更新提供的欄位
    if (typeof updates.enabled !== 'undefined') {
      updatedSettings.enabled = Boolean(updates.enabled);
    }
    if (typeof updates.requiredAccuracy !== 'undefined') {
      updatedSettings.requiredAccuracy = Math.max(10, Math.min(500, parseInt(updates.requiredAccuracy)));
    }
    if (typeof updates.allowOfflineMode !== 'undefined') {
      updatedSettings.allowOfflineMode = Boolean(updates.allowOfflineMode);
    }
    if (typeof updates.offlineGracePeriod !== 'undefined') {
      updatedSettings.offlineGracePeriod = Math.max(1, Math.min(60, parseInt(updates.offlineGracePeriod)));
    }
    if (typeof updates.maxDistanceVariance !== 'undefined') {
      updatedSettings.maxDistanceVariance = Math.max(5, Math.min(100, parseInt(updates.maxDistanceVariance)));
    }
    if (typeof updates.verificationTimeout !== 'undefined') {
      updatedSettings.verificationTimeout = Math.max(10, Math.min(120, parseInt(updates.verificationTimeout)));
    }
    if (typeof updates.enableLocationHistory !== 'undefined') {
      updatedSettings.enableLocationHistory = Boolean(updates.enableLocationHistory);
    }
    if (typeof updates.requireAddressInfo !== 'undefined') {
      updatedSettings.requireAddressInfo = Boolean(updates.requireAddressInfo);
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
