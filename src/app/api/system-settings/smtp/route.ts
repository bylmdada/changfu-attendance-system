import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

const MASKED_SMTP_PASSWORD = '********';

const DEFAULT_SMTP_SETTINGS = {
  id: 0,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: true,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: '長福考勤系統'
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseSmtpPort(value: unknown, fallback: number): { value: number | null; isValid: boolean } {
  if (value === undefined) {
    return { value: fallback, isValid: true };
  }

  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;

  if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 65535) {
    return { value: null, isValid: false };
  }

  return { value: parsedValue, isValid: true };
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    // 讀取現有設定，若尚未設定則回傳預設值，避免 GET 產生隱性寫入
    const settings = await prisma.smtpSettings.findFirst();

    // 隱藏密碼
    const safeSettings = {
      id: settings?.id ?? DEFAULT_SMTP_SETTINGS.id,
      smtpHost: normalizeOptionalString(settings?.smtpHost) ?? DEFAULT_SMTP_SETTINGS.smtpHost,
      smtpPort: settings?.smtpPort ?? DEFAULT_SMTP_SETTINGS.smtpPort,
      smtpSecure: settings?.smtpSecure ?? DEFAULT_SMTP_SETTINGS.smtpSecure,
      smtpUser: normalizeOptionalString(settings?.smtpUser) ?? DEFAULT_SMTP_SETTINGS.smtpUser,
      smtpPassword: settings?.smtpPassword ? MASKED_SMTP_PASSWORD : '',
      fromEmail: normalizeOptionalString(settings?.fromEmail) ?? DEFAULT_SMTP_SETTINGS.fromEmail,
      fromName: normalizeOptionalString(settings?.fromName) ?? DEFAULT_SMTP_SETTINGS.fromName,
    };

    return NextResponse.json({ settings: safeSettings });
  } catch (error) {
    console.error('取得 SMTP 設定失敗:', error);
    return NextResponse.json({ error: '取得設定失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      if (parseResult.error === 'empty_body') {
        return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
      }

      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const {
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPassword,
      fromEmail,
      fromName,
    } = body as {
      smtpHost?: unknown;
      smtpPort?: unknown;
      smtpSecure?: unknown;
      smtpUser?: unknown;
      smtpPassword?: unknown;
      fromEmail?: unknown;
      fromName?: unknown;
    };

    // 取得現有設定
    const existing = await prisma.smtpSettings.findFirst();
    const existingHost = normalizeOptionalString(existing?.smtpHost);
    const existingUser = normalizeOptionalString(existing?.smtpUser);
    const existingFromEmail = normalizeOptionalString(existing?.fromEmail);
    const existingFromName = normalizeOptionalString(existing?.fromName);
    const existingPassword = typeof existing?.smtpPassword === 'string' ? existing.smtpPassword : '';
    const smtpHostValue = smtpHost === undefined ? existingHost : normalizeOptionalString(smtpHost);
    const smtpUserValue = smtpUser === undefined ? existingUser : normalizeOptionalString(smtpUser);
    const fromEmailValue = fromEmail === undefined ? existingFromEmail : normalizeOptionalString(fromEmail);
    const fromNameValue = fromName === undefined ? existingFromName ?? '長福考勤系統' : normalizeOptionalString(fromName) ?? '長福考勤系統';
    const smtpSecureValue = typeof smtpSecure === 'boolean' ? smtpSecure : existing?.smtpSecure ?? true;
    const smtpPortResult = parseSmtpPort(smtpPort, existing?.smtpPort ?? 587);

    if (!smtpPortResult.isValid || smtpPortResult.value === null) {
      return NextResponse.json({ error: 'SMTP 埠號必須是 1 到 65535 之間的整數' }, { status: 400 });
    }

    const incomingPassword = typeof smtpPassword === 'string' ? smtpPassword : undefined;
    const effectivePassword = incomingPassword === undefined || incomingPassword === '' || incomingPassword === MASKED_SMTP_PASSWORD
      ? existingPassword
      : incomingPassword;

    if (!smtpHostValue) {
      return NextResponse.json({ error: 'SMTP 主機不可為空' }, { status: 400 });
    }

    if (!smtpUserValue) {
      return NextResponse.json({ error: 'SMTP 帳號不可為空' }, { status: 400 });
    }

    if (!effectivePassword) {
      return NextResponse.json({ error: 'SMTP 密碼不可為空' }, { status: 400 });
    }

    if (fromEmailValue && !isValidEmail(fromEmailValue)) {
      return NextResponse.json({ error: '寄件人 Email 格式不正確' }, { status: 400 });
    }

    const updateData: {
      smtpHost: string;
      smtpPort: number;
      smtpSecure: boolean;
      smtpUser: string;
      smtpPassword?: string;
      fromEmail: string;
      fromName: string;
    } = {
      smtpHost: smtpHostValue,
      smtpPort: smtpPortResult.value,
      smtpSecure: smtpSecureValue,
      smtpUser: smtpUserValue,
      fromEmail: fromEmailValue ?? '',
      fromName: fromNameValue
    };

    // 只有當密碼不是遮罩值時才更新
    if (typeof incomingPassword === 'string' && incomingPassword !== '' && incomingPassword !== MASKED_SMTP_PASSWORD) {
      updateData.smtpPassword = incomingPassword;
    }

    let settings;
    if (existing) {
      settings = await prisma.smtpSettings.update({
        where: { id: existing.id },
        data: updateData
      });
    } else {
      settings = await prisma.smtpSettings.create({
        data: {
          ...updateData,
          smtpPassword: effectivePassword
        }
      });
    }

    // 隱藏密碼
    const safeSettings = {
      ...settings,
      smtpHost: normalizeOptionalString(settings.smtpHost) ?? '',
      smtpUser: normalizeOptionalString(settings.smtpUser) ?? '',
      fromEmail: normalizeOptionalString(settings.fromEmail) ?? '',
      fromName: normalizeOptionalString(settings.fromName) ?? DEFAULT_SMTP_SETTINGS.fromName,
      smtpPassword: settings.smtpPassword ? MASKED_SMTP_PASSWORD : ''
    };

    return NextResponse.json({ settings: safeSettings, message: '設定已儲存' });
  } catch (error) {
    console.error('儲存 SMTP 設定失敗:', error);
    return NextResponse.json({ error: '儲存設定失敗' }, { status: 500 });
  }
}
