import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

const DEFAULT_SETTINGS = {
  enabled: false,
  notifyLeaveApproval: true,
  notifyOvertimeApproval: true,
  notifyShiftApproval: true,
  notifyAnnualLeaveExpiry: true,
};

const LEGACY_SETTINGS_KEY = 'email_notification_settings';
const LEGACY_DEFAULT_SETTINGS = {
  enabled: false,
  notifyLeaveApproval: true,
  notifyOvertimeApproval: true,
  notifyScheduleChange: true,
  notifyPasswordReset: true,
};

const BOOLEAN_FIELDS = [
  'enabled',
  'notifyLeaveApproval',
  'notifyOvertimeApproval',
  'notifyShiftApproval',
  'notifyAnnualLeaveExpiry',
] as const;

type EmailNotificationSettings = typeof DEFAULT_SETTINGS;

function mapStoredSettings(
  settings: {
    emailEnabled?: boolean | null;
    leaveApprovalNotify?: boolean | null;
    overtimeApprovalNotify?: boolean | null;
    shiftApprovalNotify?: boolean | null;
    annualLeaveExpiryNotify?: boolean | null;
  } | null | undefined
): EmailNotificationSettings {
  if (!settings) {
    return DEFAULT_SETTINGS;
  }

  return {
    enabled: settings.emailEnabled ?? DEFAULT_SETTINGS.enabled,
    notifyLeaveApproval: settings.leaveApprovalNotify ?? DEFAULT_SETTINGS.notifyLeaveApproval,
    notifyOvertimeApproval: settings.overtimeApprovalNotify ?? DEFAULT_SETTINGS.notifyOvertimeApproval,
    notifyShiftApproval: settings.shiftApprovalNotify ?? DEFAULT_SETTINGS.notifyShiftApproval,
    notifyAnnualLeaveExpiry: settings.annualLeaveExpiryNotify ?? DEFAULT_SETTINGS.notifyAnnualLeaveExpiry,
  };
}

function mapLegacySettings(rawValue: string | null | undefined): EmailNotificationSettings {
  const parsed = safeParseSystemSettingsValue(rawValue, LEGACY_DEFAULT_SETTINGS, LEGACY_SETTINGS_KEY);

  return {
    enabled: parsed.enabled ?? DEFAULT_SETTINGS.enabled,
    notifyLeaveApproval: parsed.notifyLeaveApproval ?? DEFAULT_SETTINGS.notifyLeaveApproval,
    notifyOvertimeApproval: parsed.notifyOvertimeApproval ?? DEFAULT_SETTINGS.notifyOvertimeApproval,
    notifyShiftApproval: parsed.notifyScheduleChange ?? DEFAULT_SETTINGS.notifyShiftApproval,
    notifyAnnualLeaveExpiry: DEFAULT_SETTINGS.notifyAnnualLeaveExpiry,
  };
}

async function verifyAdmin(request: NextRequest) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return {
      error: NextResponse.json({ error: '未授權訪問' }, { status: 401 })
    };
  }

  if (user.role !== 'ADMIN') {
    return {
      error: NextResponse.json({ error: '需要管理員權限' }, { status: 403 })
    };
  }

  return { user };
}

async function loadEmailNotificationSettings(): Promise<EmailNotificationSettings> {
  const currentSettings = await prisma.systemNotificationSettings.findFirst();
  if (currentSettings) {
    return mapStoredSettings(currentSettings);
  }

  const legacySettings = await prisma.systemSettings.findUnique({
    where: { key: LEGACY_SETTINGS_KEY }
  });

  if (legacySettings) {
    return mapLegacySettings(legacySettings.value);
  }

  return DEFAULT_SETTINGS;
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const authResult = await verifyAdmin(request);
    if (authResult.error) {
      return authResult.error;
    }

    const settings = await loadEmailNotificationSettings();

    return NextResponse.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error('取得 Email 設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const authResult = await verifyAdmin(request);
    if (authResult.error) {
      return authResult.error;
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const data = body as Record<string, unknown>;

    for (const field of BOOLEAN_FIELDS) {
      if (field in data && typeof data[field] !== 'boolean') {
        return NextResponse.json({ error: '通知開關欄位必須為布林值' }, { status: 400 });
      }
    }

    const existing = await prisma.systemNotificationSettings.findFirst();
    const baseSettings = existing ? mapStoredSettings(existing) : await loadEmailNotificationSettings();
    const nextSettings: EmailNotificationSettings = {
      enabled: typeof data.enabled === 'boolean' ? data.enabled : baseSettings.enabled,
      notifyLeaveApproval: typeof data.notifyLeaveApproval === 'boolean' ? data.notifyLeaveApproval : baseSettings.notifyLeaveApproval,
      notifyOvertimeApproval: typeof data.notifyOvertimeApproval === 'boolean' ? data.notifyOvertimeApproval : baseSettings.notifyOvertimeApproval,
      notifyShiftApproval: typeof data.notifyShiftApproval === 'boolean' ? data.notifyShiftApproval : baseSettings.notifyShiftApproval,
      notifyAnnualLeaveExpiry: typeof data.notifyAnnualLeaveExpiry === 'boolean' ? data.notifyAnnualLeaveExpiry : baseSettings.notifyAnnualLeaveExpiry,
    };

    let settings;
    if (existing) {
      settings = await prisma.systemNotificationSettings.update({
        where: { id: existing.id },
        data: {
          emailEnabled: nextSettings.enabled,
          inAppEnabled: existing.inAppEnabled,
          leaveApprovalNotify: nextSettings.notifyLeaveApproval,
          overtimeApprovalNotify: nextSettings.notifyOvertimeApproval,
          shiftApprovalNotify: nextSettings.notifyShiftApproval,
          annualLeaveExpiryNotify: nextSettings.notifyAnnualLeaveExpiry,
          annualLeaveExpiryDays: existing.annualLeaveExpiryDays,
        }
      });
    } else {
      settings = await prisma.systemNotificationSettings.create({
        data: {
          emailEnabled: nextSettings.enabled,
          inAppEnabled: true,
          leaveApprovalNotify: nextSettings.notifyLeaveApproval,
          overtimeApprovalNotify: nextSettings.notifyOvertimeApproval,
          shiftApprovalNotify: nextSettings.notifyShiftApproval,
          annualLeaveExpiryNotify: nextSettings.notifyAnnualLeaveExpiry,
          annualLeaveExpiryDays: 30,
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Email 通知設定已更新',
      settings: mapStoredSettings(settings),
    });
  } catch (error) {
    console.error('更新 Email 設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
