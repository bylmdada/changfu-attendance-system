/**
 * 薪資條 Email 發送設定 API
 * GET: 取得設定
 * PUT: 更新設定
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

const DEFAULT_PAYSLIP_EMAIL_SETTINGS = {
  id: 0,
  enabled: false,
  smtpHost: null,
  smtpPort: 587,
  smtpSecure: true,
  smtpUser: null,
  smtpPassword: null,
  fromEmail: null,
  fromName: '薪資系統',
  subjectTemplate: '[%YEAR%年%MONTH%月] 薪資條通知',
  bodyTemplate: `親愛的 %NAME% 您好,

您的 %YEAR%年%MONTH%月 薪資條已產生，請查收附件。

如有任何問題，請洽人事部門。

  此為系統自動發送信件，請勿直接回覆。`
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  return value;
}

function parseBooleanSetting(value: unknown, fallback: boolean) {
  if (value === undefined) {
    return { value: fallback, isValid: true };
  }

  if (typeof value !== 'boolean') {
    return { value: fallback, isValid: false };
  }

  return { value, isValid: true };
}

function parseSmtpPortSetting(value: unknown, fallback: number) {
  if (value === undefined) {
    return { value: fallback, isValid: true };
  }

  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;

  if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 65535) {
    return { value: fallback, isValid: false };
  }

  return { value: parsedValue, isValid: true };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    // 取得設定（只會有一筆），若尚未設定則回傳預設值，避免 GET 建立資料
    const settings = await prisma.payslipEmailSettings.findFirst();

    // 隱藏密碼
    const safeSettings = {
      ...(settings ?? DEFAULT_PAYSLIP_EMAIL_SETTINGS),
      smtpPassword: settings?.smtpPassword ? '********' : null
    };

    return NextResponse.json({
      success: true,
      settings: safeSettings
    });

  } catch (error) {
    console.error('取得薪資條發送設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: parseResult.error === 'empty_body'
            ? '請提供有效的設定資料'
            : '無效的 JSON 格式'
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;
    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }
    const {
      enabled,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPassword,
      fromEmail,
      fromName,
      subjectTemplate,
      bodyTemplate
    } = data;

    // 取得現有設定
    const existing = await prisma.payslipEmailSettings.findFirst();
    const enabledResult = parseBooleanSetting(enabled, existing?.enabled ?? false);
    const smtpPortResult = parseSmtpPortSetting(smtpPort, existing?.smtpPort ?? 587);
    const smtpSecureResult = parseBooleanSetting(smtpSecure, existing?.smtpSecure ?? true);
    const smtpHostValue = normalizeOptionalString(smtpHost);
    const smtpUserValue = normalizeOptionalString(smtpUser);
    const smtpPasswordValue = normalizeOptionalString(smtpPassword);
    const fromEmailValue = normalizeOptionalString(fromEmail);
    const fromNameValue = normalizeOptionalString(fromName);
    const subjectTemplateValue = normalizeOptionalString(subjectTemplate);
    const bodyTemplateValue = normalizeOptionalString(bodyTemplate);

    if (!enabledResult.isValid) {
      return NextResponse.json({ error: '啟用設定格式無效' }, { status: 400 });
    }

    if (!smtpPortResult.isValid) {
      return NextResponse.json({ error: 'SMTP 埠號必須是 1 到 65535 之間的整數' }, { status: 400 });
    }

    if (!smtpSecureResult.isValid) {
      return NextResponse.json({ error: 'SMTP 安全設定格式無效' }, { status: 400 });
    }

    if (smtpHost !== undefined && smtpHostValue === undefined) {
      return NextResponse.json({ error: 'SMTP 主機格式無效' }, { status: 400 });
    }

    if (smtpUser !== undefined && smtpUserValue === undefined) {
      return NextResponse.json({ error: 'SMTP 帳號格式無效' }, { status: 400 });
    }

    if (smtpPassword !== undefined && smtpPasswordValue === undefined) {
      return NextResponse.json({ error: 'SMTP 密碼格式無效' }, { status: 400 });
    }

    if (fromEmail !== undefined && fromEmailValue === undefined) {
      return NextResponse.json({ error: '寄件人 Email 格式無效' }, { status: 400 });
    }

    if (fromName !== undefined && fromNameValue === undefined) {
      return NextResponse.json({ error: '寄件人名稱格式無效' }, { status: 400 });
    }

    if (subjectTemplate !== undefined && subjectTemplateValue === undefined) {
      return NextResponse.json({ error: '郵件主旨格式無效' }, { status: 400 });
    }

    if (bodyTemplate !== undefined && bodyTemplateValue === undefined) {
      return NextResponse.json({ error: '郵件內容格式無效' }, { status: 400 });
    }
    
    // 準備更新資料
    const updateData: Record<string, unknown> = {
      enabled: enabledResult.value,
      smtpHost: smtpHostValue === undefined ? existing?.smtpHost : smtpHostValue,
      smtpPort: smtpPortResult.value,
      smtpSecure: smtpSecureResult.value,
      smtpUser: smtpUserValue === undefined ? existing?.smtpUser : smtpUserValue,
      fromEmail: fromEmailValue === undefined ? existing?.fromEmail : fromEmailValue,
      fromName: fromNameValue === undefined ? (existing?.fromName ?? '薪資系統') : (fromNameValue ?? '薪資系統'),
      subjectTemplate: subjectTemplateValue === undefined
        ? (existing?.subjectTemplate ?? '[%YEAR%年%MONTH%月] 薪資條通知')
        : (subjectTemplateValue ?? '[%YEAR%年%MONTH%月] 薪資條通知'),
      bodyTemplate: bodyTemplateValue === undefined
        ? (existing?.bodyTemplate ?? DEFAULT_PAYSLIP_EMAIL_SETTINGS.bodyTemplate)
        : (bodyTemplateValue ?? DEFAULT_PAYSLIP_EMAIL_SETTINGS.bodyTemplate)
    };

    // 只有在密碼不是遮罩時才更新
    if (typeof smtpPasswordValue === 'string' && smtpPasswordValue !== '********') {
      updateData.smtpPassword = smtpPasswordValue;
    }

    let settings;
    if (existing) {
      settings = await prisma.payslipEmailSettings.update({
        where: { id: existing.id },
        data: updateData
      });
    } else {
      settings = await prisma.payslipEmailSettings.create({
        data: updateData as {
          enabled: boolean;
          smtpHost?: string;
          smtpPort?: number;
          smtpSecure?: boolean;
          smtpUser?: string;
          smtpPassword?: string;
          fromEmail?: string;
          fromName?: string;
          subjectTemplate?: string;
          bodyTemplate?: string;
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: '設定已儲存',
      settings: {
        ...settings,
        smtpPassword: settings.smtpPassword ? '********' : null
      }
    });

  } catch (error) {
    console.error('更新薪資條發送設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
