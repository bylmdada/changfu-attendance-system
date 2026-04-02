import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

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

// GET - 取得 Email 通知設定
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const settings = await prisma.systemSettings.findUnique({
      where: { key: SETTINGS_KEY }
    });

    if (settings) {
      const parsed = JSON.parse(settings.value);
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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();

    // 取得現有設定（保留密碼）
    const existingSettings = await prisma.systemSettings.findUnique({
      where: { key: SETTINGS_KEY }
    });

    let existingSmtpPass = '';
    if (existingSettings) {
      const parsed = JSON.parse(existingSettings.value);
      existingSmtpPass = parsed.smtpPass || '';
    }

    // 如果密碼是遮罩值，保留原密碼
    const smtpPass = body.smtpPass === '********' ? existingSmtpPass : (body.smtpPass || '');

    const newSettings = {
      enabled: body.enabled ?? DEFAULT_SETTINGS.enabled,
      smtpHost: body.smtpHost || DEFAULT_SETTINGS.smtpHost,
      smtpPort: body.smtpPort || DEFAULT_SETTINGS.smtpPort,
      smtpSecure: body.smtpSecure ?? DEFAULT_SETTINGS.smtpSecure,
      smtpUser: body.smtpUser || DEFAULT_SETTINGS.smtpUser,
      smtpPass,
      senderName: body.senderName || DEFAULT_SETTINGS.senderName,
      senderEmail: body.senderEmail || DEFAULT_SETTINGS.senderEmail,
      notifyLeaveApproval: body.notifyLeaveApproval ?? DEFAULT_SETTINGS.notifyLeaveApproval,
      notifyOvertimeApproval: body.notifyOvertimeApproval ?? DEFAULT_SETTINGS.notifyOvertimeApproval,
      notifyScheduleChange: body.notifyScheduleChange ?? DEFAULT_SETTINGS.notifyScheduleChange,
      notifyPasswordReset: body.notifyPasswordReset ?? DEFAULT_SETTINGS.notifyPasswordReset
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
