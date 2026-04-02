/**
 * 薪資條 Email 發送設定 API
 * GET: 取得設定
 * PUT: 更新設定
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    // 取得設定（只會有一筆）
    let settings = await prisma.payslipEmailSettings.findFirst();
    
    // 如果沒有設定，建立預設值
    if (!settings) {
      settings = await prisma.payslipEmailSettings.create({
        data: {
          enabled: false,
          smtpPort: 587,
          smtpSecure: true,
          fromName: '薪資系統',
          subjectTemplate: '[%YEAR%年%MONTH%月] 薪資條通知',
          bodyTemplate: `親愛的 %NAME% 您好，

您的 %YEAR%年%MONTH%月 薪資條已產生，請查收附件。

如有任何問題，請洽人事部門。

此為系統自動發送信件，請勿直接回覆。`
        }
      });
    }

    // 隱藏密碼
    const safeSettings = {
      ...settings,
      smtpPassword: settings.smtpPassword ? '********' : null
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

    const data = await request.json();
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
