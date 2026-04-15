/**
 * 系統通知設定 API
 * GET: 取得通知設定
 * POST: 更新通知設定
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

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

const BOOLEAN_FIELDS = [
  'emailEnabled',
  'inAppEnabled',
  'leaveApprovalNotify',
  'overtimeApprovalNotify',
  'shiftApprovalNotify',
  'annualLeaveExpiryNotify',
] as const;

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

    const bodyResult = await safeParseJSON(request);

    if (!bodyResult.success) {
      return NextResponse.json(
        {
          error: bodyResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式'
        },
        { status: 400 }
      );
    }

    const data = bodyResult.data;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    for (const field of BOOLEAN_FIELDS) {
      if (field in data && typeof data[field] !== 'boolean') {
        return NextResponse.json({ error: '通知開關欄位必須為布林值' }, { status: 400 });
      }
    }

    const annualLeaveExpiryDays = data.annualLeaveExpiryDays;

    if (
      annualLeaveExpiryDays !== undefined && (
        typeof annualLeaveExpiryDays !== 'number' ||
        !Number.isInteger(annualLeaveExpiryDays) ||
        annualLeaveExpiryDays < 0 ||
        annualLeaveExpiryDays > 365
      )
    ) {
      return NextResponse.json({ error: '年假到期提醒天數必須為 0 到 365 的整數' }, { status: 400 });
    }

    const emailEnabled = typeof data.emailEnabled === 'boolean' ? data.emailEnabled : undefined;
    const inAppEnabled = typeof data.inAppEnabled === 'boolean' ? data.inAppEnabled : undefined;
    const leaveApprovalNotify = typeof data.leaveApprovalNotify === 'boolean' ? data.leaveApprovalNotify : undefined;
    const overtimeApprovalNotify = typeof data.overtimeApprovalNotify === 'boolean' ? data.overtimeApprovalNotify : undefined;
    const shiftApprovalNotify = typeof data.shiftApprovalNotify === 'boolean' ? data.shiftApprovalNotify : undefined;
    const annualLeaveExpiryNotify = typeof data.annualLeaveExpiryNotify === 'boolean' ? data.annualLeaveExpiryNotify : undefined;
    const normalizedAnnualLeaveExpiryDays = typeof annualLeaveExpiryDays === 'number'
      ? annualLeaveExpiryDays
      : undefined;

    // 查找現有設定
    const existing = await prisma.systemNotificationSettings.findFirst();

    let settings;
    if (existing) {
      settings = await prisma.systemNotificationSettings.update({
        where: { id: existing.id },
        data: {
          emailEnabled: emailEnabled ?? existing.emailEnabled,
          inAppEnabled: inAppEnabled ?? existing.inAppEnabled,
          leaveApprovalNotify: leaveApprovalNotify ?? existing.leaveApprovalNotify,
          overtimeApprovalNotify: overtimeApprovalNotify ?? existing.overtimeApprovalNotify,
          shiftApprovalNotify: shiftApprovalNotify ?? existing.shiftApprovalNotify,
          annualLeaveExpiryNotify: annualLeaveExpiryNotify ?? existing.annualLeaveExpiryNotify,
          annualLeaveExpiryDays: normalizedAnnualLeaveExpiryDays ?? existing.annualLeaveExpiryDays,
        },
      });
    } else {
      settings = await prisma.systemNotificationSettings.create({
        data: {
          emailEnabled: emailEnabled ?? DEFAULT_SETTINGS.emailEnabled,
          inAppEnabled: inAppEnabled ?? DEFAULT_SETTINGS.inAppEnabled,
          leaveApprovalNotify: leaveApprovalNotify ?? DEFAULT_SETTINGS.leaveApprovalNotify,
          overtimeApprovalNotify: overtimeApprovalNotify ?? DEFAULT_SETTINGS.overtimeApprovalNotify,
          shiftApprovalNotify: shiftApprovalNotify ?? DEFAULT_SETTINGS.shiftApprovalNotify,
          annualLeaveExpiryNotify: annualLeaveExpiryNotify ?? DEFAULT_SETTINGS.annualLeaveExpiryNotify,
          annualLeaveExpiryDays: normalizedAnnualLeaveExpiryDays ?? DEFAULT_SETTINGS.annualLeaveExpiryDays,
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
