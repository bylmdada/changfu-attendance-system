import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    // 取得或建立預設設定
    let settings = await prisma.smtpSettings.findFirst();
    
    if (!settings) {
      settings = await prisma.smtpSettings.create({
        data: {
          smtpHost: '',
          smtpPort: 587,
          smtpSecure: true,
          smtpUser: '',
          smtpPassword: '',
          fromEmail: '',
          fromName: '長福考勤系統'
        }
      });
    }

    // 隱藏密碼
    const safeSettings = {
      ...settings,
      smtpPassword: settings.smtpPassword ? '********' : ''
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

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const body = await request.json();
    const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, fromEmail, fromName } = body;

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
      smtpHost: smtpHost || '',
      smtpPort: smtpPort || 587,
      smtpSecure: smtpSecure ?? true,
      smtpUser: smtpUser || '',
      fromEmail: fromEmail || '',
      fromName: fromName || '長福考勤系統'
    };

    // 只有當密碼不是遮罩值時才更新
    if (smtpPassword && smtpPassword !== '********') {
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
          smtpPassword: smtpPassword || ''
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
