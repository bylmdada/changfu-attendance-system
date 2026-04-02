/**
 * 年假到期提醒 API
 * POST: 觸發年假到期提醒（供定時任務調用）
 * GET: 查看即將到期的年假列表
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { sendAnnualLeaveExpiryReminders, getNotificationSettings } from '@/lib/email';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const settings = await getNotificationSettings();
    const today = new Date();
    const reminderDate = new Date();
    reminderDate.setDate(today.getDate() + settings.annualLeaveExpiryDays);

    // 查詢即將到期的年假
    const expiringLeaves = await prisma.annualLeave.findMany({
      where: {
        expiryDate: {
          gte: today,
          lte: reminderDate,
        },
        remainingDays: {
          gt: 0,
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            email: true,
          },
        },
      },
      orderBy: { expiryDate: 'asc' },
    });

    return NextResponse.json({
      success: true,
      settings: {
        annualLeaveExpiryNotify: settings.annualLeaveExpiryNotify,
        annualLeaveExpiryDays: settings.annualLeaveExpiryDays,
      },
      expiringLeaves: expiringLeaves.map(leave => ({
        id: leave.id,
        employeeId: leave.employee.employeeId,
        employeeName: leave.employee.name,
        department: leave.employee.department,
        hasEmail: !!leave.employee.email,
        remainingDays: leave.remainingDays,
        expiryDate: leave.expiryDate.toISOString().split('T')[0],
        daysUntilExpiry: Math.ceil((leave.expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
      })),
      total: expiringLeaves.length,
    });
  } catch (error) {
    console.error('查詢年假到期資訊失敗:', error);
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

    // 執行年假到期提醒
    const results = await sendAnnualLeaveExpiryReminders();

    return NextResponse.json({
      success: true,
      message: `年假到期提醒：發送 ${results.sent} 筆，跳過 ${results.skipped} 筆，失敗 ${results.failed} 筆`,
      summary: {
        sent: results.sent,
        skipped: results.skipped,
        failed: results.failed,
      },
      details: results.details,
      errors: results.errors,
    });
  } catch (error) {
    console.error('發送年假到期提醒失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
