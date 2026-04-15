import nodemailer from 'nodemailer';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getSafeErrorLog(error: unknown) {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const smtpError = error as Error & { code?: string; responseCode?: number };
  return {
    name: smtpError.name,
    code: smtpError.code,
    responseCode: smtpError.responseCode,
  };
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/smtp/test');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: '測試郵件操作過於頻繁，請稍後再試' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的測試郵件地址'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的測試郵件地址' }, { status: 400 });
    }
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: '請提供有效的測試郵件地址' }, { status: 400 });
    }

    const settings = await prisma.smtpSettings.findFirst();
    if (!settings?.smtpHost || !settings.smtpUser || !settings.smtpPassword) {
      return NextResponse.json({ error: 'SMTP 設定不完整，請先儲存郵件伺服器設定' }, { status: 400 });
    }

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort || 587,
      secure: settings.smtpSecure || false,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPassword,
      },
    });

    await transporter.sendMail({
      from: `"${settings.fromName || '長福考勤系統'}" <${settings.fromEmail || settings.smtpUser}>`,
      to: email,
      subject: '長福考勤系統 SMTP 測試郵件',
      text: '這是一封測試郵件，表示目前的 SMTP 設定可正常發送郵件。',
      html: '<p>這是一封測試郵件，表示目前的 SMTP 設定可正常發送郵件。</p>',
    });

    return NextResponse.json({
      success: true,
      message: '測試郵件已發送',
    });
  } catch (error) {
    console.error('SMTP 測試郵件發送失敗:', getSafeErrorLog(error));
    return NextResponse.json({
      error: '測試郵件發送失敗，請檢查 SMTP 設定後再試',
    }, { status: 500 });
  }
}