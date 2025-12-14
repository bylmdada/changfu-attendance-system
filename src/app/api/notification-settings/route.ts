import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const body = await request.json();
    const {
      leaveExpiry,
      leaveApproval,
      overtimeApproval,
      shiftExchangeApproval,
      systemAnnouncements
    } = body;

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
