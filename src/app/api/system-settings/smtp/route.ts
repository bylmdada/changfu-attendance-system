import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

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
      ...(settings ?? DEFAULT_SMTP_SETTINGS),
      smtpPassword: settings?.smtpPassword ? '********' : ''
    };

    return NextResponse.json({ settings: safeSettings });
  } catch (error) {
    console.error('取得 SMTP 設定失敗:', error);
    return NextResponse.json({ error: '取得設定失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
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

    const updateData: {
      smtpHost: string;
      smtpPort: number;
      smtpSecure: boolean;
      smtpUser: string;
      smtpPassword?: string;
      fromEmail: string;
      fromName: string;
    } = {
      smtpHost: typeof smtpHost === 'string' ? smtpHost : '',
      smtpPort: typeof smtpPort === 'number' ? smtpPort : 587,
      smtpSecure: typeof smtpSecure === 'boolean' ? smtpSecure : true,
      smtpUser: typeof smtpUser === 'string' ? smtpUser : '',
      fromEmail: typeof fromEmail === 'string' ? fromEmail : '',
      fromName: typeof fromName === 'string' ? fromName : '長福考勤系統'
    };

    // 只有當密碼不是遮罩值時才更新
    if (typeof smtpPassword === 'string' && smtpPassword !== '' && smtpPassword !== '********') {
      updateData.smtpPassword = smtpPassword;
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
          smtpPassword: typeof smtpPassword === 'string' ? smtpPassword : ''
        }
      });
    }

    // 隱藏密碼
    const safeSettings = {
      ...settings,
      smtpPassword: settings.smtpPassword ? '********' : ''
    };

    return NextResponse.json({ settings: safeSettings, message: '設定已儲存' });
  } catch (error) {
    console.error('儲存 SMTP 設定失敗:', error);
    return NextResponse.json({ error: '儲存設定失敗' }, { status: 500 });
  }
}
