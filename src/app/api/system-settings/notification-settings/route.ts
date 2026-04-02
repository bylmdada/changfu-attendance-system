/**
 * 系統通知設定 API
 * GET: 取得通知設定
 * POST: 更新通知設定
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

// 預設設定
const DEFAULT_SETTINGS = {
  emailEnabled: false,
  inAppEnabled: true,
  leaveApprovalNotify: true,
  overtimeApprovalNotify: true,
  shiftApprovalNotify: true,
  annualLeaveExpiryNotify: true,
  annualLeaveExpiryDays: 30,
};

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const settings = await prisma.systemNotificationSettings.findFirst();

    return NextResponse.json({
      success: true,
      settings: settings || DEFAULT_SETTINGS,
    });
  } catch (error) {
    console.error('取得通知設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

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

    const data = await request.json();

    // 查找現有設定
    const existing = await prisma.systemNotificationSettings.findFirst();

    let settings;
    if (existing) {
      settings = await prisma.systemNotificationSettings.update({
        where: { id: existing.id },
        data: {
          emailEnabled: data.emailEnabled ?? existing.emailEnabled,
          inAppEnabled: data.inAppEnabled ?? existing.inAppEnabled,
          leaveApprovalNotify: data.leaveApprovalNotify ?? existing.leaveApprovalNotify,
          overtimeApprovalNotify: data.overtimeApprovalNotify ?? existing.overtimeApprovalNotify,
          shiftApprovalNotify: data.shiftApprovalNotify ?? existing.shiftApprovalNotify,
          annualLeaveExpiryNotify: data.annualLeaveExpiryNotify ?? existing.annualLeaveExpiryNotify,
          annualLeaveExpiryDays: data.annualLeaveExpiryDays ?? existing.annualLeaveExpiryDays,
        },
      });
    } else {
      settings = await prisma.systemNotificationSettings.create({
        data: {
          emailEnabled: data.emailEnabled ?? DEFAULT_SETTINGS.emailEnabled,
          inAppEnabled: data.inAppEnabled ?? DEFAULT_SETTINGS.inAppEnabled,
          leaveApprovalNotify: data.leaveApprovalNotify ?? DEFAULT_SETTINGS.leaveApprovalNotify,
          overtimeApprovalNotify: data.overtimeApprovalNotify ?? DEFAULT_SETTINGS.overtimeApprovalNotify,
          shiftApprovalNotify: data.shiftApprovalNotify ?? DEFAULT_SETTINGS.shiftApprovalNotify,
          annualLeaveExpiryNotify: data.annualLeaveExpiryNotify ?? DEFAULT_SETTINGS.annualLeaveExpiryNotify,
          annualLeaveExpiryDays: data.annualLeaveExpiryDays ?? DEFAULT_SETTINGS.annualLeaveExpiryDays,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: '通知設定已更新',
      settings,
    });
  } catch (error) {
    console.error('更新通知設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
