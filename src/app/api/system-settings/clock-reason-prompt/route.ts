import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

interface ClockReasonPromptSettings {
  enabled: boolean;
  earlyClockInThreshold: number;  // 分鐘
  lateClockOutThreshold: number;  // 分鐘
  excludeHolidays: boolean;
  excludeApprovedOvertime: boolean;
}

const DEFAULT_SETTINGS: ClockReasonPromptSettings = {
  enabled: false,
  earlyClockInThreshold: 5,
  lateClockOutThreshold: 5,
  excludeHolidays: true,
  excludeApprovedOvertime: true
};

// GET - 取得設定
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const setting = await prisma.systemSettings.findUnique({
      where: { key: 'clock_reason_prompt' }
    });

    const settings: ClockReasonPromptSettings = setting 
      ? JSON.parse(setting.value) 
      : DEFAULT_SETTINGS;

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('取得打卡原因提示設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT - 更新設定
export async function PUT(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const settings: ClockReasonPromptSettings = {
      enabled: body.enabled ?? DEFAULT_SETTINGS.enabled,
      earlyClockInThreshold: body.earlyClockInThreshold ?? DEFAULT_SETTINGS.earlyClockInThreshold,
      lateClockOutThreshold: body.lateClockOutThreshold ?? DEFAULT_SETTINGS.lateClockOutThreshold,
      excludeHolidays: body.excludeHolidays ?? DEFAULT_SETTINGS.excludeHolidays,
      excludeApprovedOvertime: body.excludeApprovedOvertime ?? DEFAULT_SETTINGS.excludeApprovedOvertime
    };

    // 驗證閾值
    if (settings.earlyClockInThreshold < 1 || settings.earlyClockInThreshold > 120) {
      return NextResponse.json({ error: '提早上班閾值需在 1-120 分鐘之間' }, { status: 400 });
    }
    if (settings.lateClockOutThreshold < 1 || settings.lateClockOutThreshold > 120) {
      return NextResponse.json({ error: '延後下班閾值需在 1-120 分鐘之間' }, { status: 400 });
    }

    await prisma.systemSettings.upsert({
      where: { key: 'clock_reason_prompt' },
      update: { value: JSON.stringify(settings) },
      create: { key: 'clock_reason_prompt', value: JSON.stringify(settings) }
    });

    return NextResponse.json({ success: true, settings, message: '設定已儲存' });
  } catch (error) {
    console.error('更新打卡原因提示設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
