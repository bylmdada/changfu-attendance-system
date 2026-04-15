import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

// 預設通知設定
const DEFAULT_SETTINGS = {
  leaveExpiry: true,
  leaveApproval: true,
  overtimeApproval: true,
  shiftExchangeApproval: true,
  systemAnnouncements: true
};

// GET - 取得通知設定
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded.employeeId) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
    }

    const settings = await prisma.notificationSettings.findUnique({
      where: { employeeId: decoded.employeeId }
    });

    return NextResponse.json({
      success: true,
      settings: settings || {
        employeeId: decoded.employeeId,
        ...DEFAULT_SETTINGS
      }
    });
  } catch (error) {
    console.error('取得通知設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 更新通知設定
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!decoded.employeeId) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 400 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const body = isRecord(parsedBody.data) ? parsedBody.data : {};
    const leaveExpiry = typeof body.leaveExpiry === 'boolean' ? body.leaveExpiry : undefined;
    const leaveApproval = typeof body.leaveApproval === 'boolean' ? body.leaveApproval : undefined;
    const overtimeApproval = typeof body.overtimeApproval === 'boolean' ? body.overtimeApproval : undefined;
    const shiftExchangeApproval = typeof body.shiftExchangeApproval === 'boolean' ? body.shiftExchangeApproval : undefined;
    const systemAnnouncements = typeof body.systemAnnouncements === 'boolean' ? body.systemAnnouncements : undefined;

    const booleanFields = {
      leaveExpiry,
      leaveApproval,
      overtimeApproval,
      shiftExchangeApproval,
      systemAnnouncements
    };

    for (const [fieldName, fieldValue] of Object.entries(isRecord(parsedBody.data) ? parsedBody.data : {})) {
      if (fieldName in booleanFields && fieldValue !== undefined && typeof fieldValue !== 'boolean') {
        return NextResponse.json({ error: `${fieldName} 參數格式無效` }, { status: 400 });
      }
    }

    const settings = await prisma.notificationSettings.upsert({
      where: { employeeId: decoded.employeeId },
      update: {
        leaveExpiry: leaveExpiry ?? DEFAULT_SETTINGS.leaveExpiry,
        leaveApproval: leaveApproval ?? DEFAULT_SETTINGS.leaveApproval,
        overtimeApproval: overtimeApproval ?? DEFAULT_SETTINGS.overtimeApproval,
        shiftExchangeApproval: shiftExchangeApproval ?? DEFAULT_SETTINGS.shiftExchangeApproval,
        systemAnnouncements: systemAnnouncements ?? DEFAULT_SETTINGS.systemAnnouncements
      },
      create: {
        employeeId: decoded.employeeId,
        leaveExpiry: leaveExpiry ?? DEFAULT_SETTINGS.leaveExpiry,
        leaveApproval: leaveApproval ?? DEFAULT_SETTINGS.leaveApproval,
        overtimeApproval: overtimeApproval ?? DEFAULT_SETTINGS.overtimeApproval,
        shiftExchangeApproval: shiftExchangeApproval ?? DEFAULT_SETTINGS.shiftExchangeApproval,
        systemAnnouncements: systemAnnouncements ?? DEFAULT_SETTINGS.systemAnnouncements
      }
    });

    return NextResponse.json({
      success: true,
      message: '通知設定已更新',
      settings
    });
  } catch (error) {
    console.error('更新通知設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
