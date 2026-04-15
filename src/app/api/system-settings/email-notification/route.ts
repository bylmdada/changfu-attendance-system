import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

// 預設 Email 通知設定（預設關閉）
const DEFAULT_SETTINGS = {
  enabled: false, // 預設關閉
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPass: '',
  senderName: '長福考勤系統',
  senderEmail: '',
  // 通知類型開關
  notifyLeaveApproval: true,
  notifyOvertimeApproval: true,
  notifyScheduleChange: true,
  notifyPasswordReset: true
};

const SETTINGS_KEY = 'email_notification_settings';

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

// GET - 取得 Email 通知設定
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

    const settings = await prisma.systemSettings.findUnique({
      where: { key: SETTINGS_KEY }
    });

    if (settings) {
      const parsed = safeParseSystemSettingsValue(settings.value, DEFAULT_SETTINGS, SETTINGS_KEY);
      // 不回傳密碼明文
      return NextResponse.json({
        success: true,
        settings: {
          ...parsed,
          smtpPass: parsed.smtpPass ? '********' : ''
        }
      });
    }

    return NextResponse.json({
      success: true,
      settings: {
        ...DEFAULT_SETTINGS,
        smtpPass: ''
      }
    });
  } catch (error) {
    console.error('取得 Email 設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 更新 Email 通知設定
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const authResult = await verifyAdmin(request);
    if (authResult.error) {
      return authResult.error;
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

    // 取得現有設定（保留密碼）
    const existingSettings = await prisma.systemSettings.findUnique({
      where: { key: SETTINGS_KEY }
    });

    const baseSettings = safeParseSystemSettingsValue(existingSettings?.value, DEFAULT_SETTINGS, SETTINGS_KEY);
    const existingSmtpPass = baseSettings.smtpPass || '';

    // 如果密碼是遮罩值，保留原密碼
    const smtpPass = body.smtpPass === '********' ? existingSmtpPass : (body.smtpPass ?? '');

    const newSettings = {
      enabled: body.enabled ?? baseSettings.enabled,
      smtpHost: body.smtpHost ?? baseSettings.smtpHost,
      smtpPort: body.smtpPort ?? baseSettings.smtpPort,
      smtpSecure: body.smtpSecure ?? baseSettings.smtpSecure,
      smtpUser: body.smtpUser ?? baseSettings.smtpUser,
      smtpPass,
      senderName: body.senderName ?? baseSettings.senderName,
      senderEmail: body.senderEmail ?? baseSettings.senderEmail,
      notifyLeaveApproval: body.notifyLeaveApproval ?? baseSettings.notifyLeaveApproval,
      notifyOvertimeApproval: body.notifyOvertimeApproval ?? baseSettings.notifyOvertimeApproval,
      notifyScheduleChange: body.notifyScheduleChange ?? baseSettings.notifyScheduleChange,
      notifyPasswordReset: body.notifyPasswordReset ?? baseSettings.notifyPasswordReset
    };

    await prisma.systemSettings.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: JSON.stringify(newSettings) },
      create: {
        key: SETTINGS_KEY,
        value: JSON.stringify(newSettings),
        description: 'Email 通知設定'
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Email 通知設定已更新',
      settings: {
        ...newSettings,
        smtpPass: newSettings.smtpPass ? '********' : ''
      }
    });
  } catch (error) {
    console.error('更新 Email 設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
