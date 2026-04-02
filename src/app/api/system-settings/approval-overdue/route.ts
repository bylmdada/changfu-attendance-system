/**
 * 審核逾期自動處理設定 API
 * GET: 取得設定
 * PUT: 更新設定
 * POST: 手動執行一次處理
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { 
  getOverdueSettings, 
  updateOverdueSettings, 
  processOverdueApprovals,
  getOverdueStats 
} from '@/lib/approval-scheduler';

// GET: 取得設定和統計
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const settings = await getOverdueSettings();
    const stats = await getOverdueStats();

    return NextResponse.json({
      success: true,
      settings,
      stats
    });

  } catch (error) {
    console.error('取得逾期處理設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT: 更新設定
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
    
    // 驗證數值範圍
    if (data.autoEscalateHours !== undefined) {
      if (data.autoEscalateHours < 1 || data.autoEscalateHours > 168) {
        return NextResponse.json({ error: '自動升級時間需在 1-168 小時之間' }, { status: 400 });
      }
    }

    if (data.autoRejectDays !== undefined) {
      if (data.autoRejectDays < 1 || data.autoRejectDays > 30) {
        return NextResponse.json({ error: '自動拒絕天數需在 1-30 天之間' }, { status: 400 });
      }
    }

    const result = await updateOverdueSettings(data);

    if (!result.success) {
      return NextResponse.json({ error: '更新失敗' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '設定已更新',
      settings: result.settings
    });

  } catch (error) {
    console.error('更新逾期處理設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST: 手動執行一次處理
export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}));
    const forceRun = body.forceRun === true;

    // 如果不是強制執行，檢查設定
    if (!forceRun) {
      const settings = await getOverdueSettings();
      if (!settings.enabled) {
        return NextResponse.json({
          success: false,
          message: '功能未啟用。若要強制執行，請設定 forceRun: true'
        }, { status: 400 });
      }
    }

    // 執行處理
    const result = await processOverdueApprovals();

    return NextResponse.json({
      success: true,
      message: '已執行逾期處理',
      result
    });

  } catch (error) {
    console.error('手動執行逾期處理失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
