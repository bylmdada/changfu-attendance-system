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
    
    // 準備更新資料
    const updateData: Record<string, unknown> = {
      enabled: enabled ?? false,
      smtpHost,
      smtpPort: smtpPort ?? 587,
      smtpSecure: smtpSecure ?? true,
      smtpUser,
      fromEmail,
      fromName: fromName ?? '薪資系統',
      subjectTemplate: subjectTemplate ?? '[%YEAR%年%MONTH%月] 薪資條通知',
      bodyTemplate
    };

    // 只有在密碼不是遮罩時才更新
    if (smtpPassword && smtpPassword !== '********') {
      updateData.smtpPassword = smtpPassword;
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
