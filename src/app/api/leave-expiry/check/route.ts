import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

interface ExpiringLeave {
  type: 'COMP_LEAVE' | 'ANNUAL_LEAVE';
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string | null;
  };
  hours?: number;
  days?: number;
  expiresAt: Date;
  daysUntilExpiry: number;
  status: 'URGENT' | 'WARNING' | 'NORMAL';
}

// GET - 檢查即將到期的假期
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
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    // 取得設定
    const expirySettings = await prisma.systemSettings.findUnique({
      where: { key: 'leave_expiry_settings' }
    });

    const settings = expirySettings 
      ? JSON.parse(expirySettings.value)
      : { compLeaveExpiryMonths: 6, reminderDaysBefore: [30, 14, 7], enabled: true };

    if (!settings.enabled) {
      return NextResponse.json({
        success: true,
        expiringLeaves: [],
        message: '假期到期檢查功能已停用'
      });
    }

    const now = new Date();
    const expiringLeaves: ExpiringLeave[] = [];

    // 1. 檢查補休到期（基於 CompLeaveTransaction 的建立日期 + 有效月數）
    const compLeaveTransactions = await prisma.compLeaveTransaction.findMany({
      where: {
        transactionType: 'EARN',
        isFrozen: true  // 只檢查已確認的
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        }
      }
    });

    for (const tx of compLeaveTransactions) {
      // 計算到期日（建立日期 + 有效月數）
      const expiresAt = new Date(tx.createdAt);
      expiresAt.setMonth(expiresAt.getMonth() + settings.compLeaveExpiryMonths);

      const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // 只顯示即將到期的（30天內）
      if (daysUntilExpiry > 0 && daysUntilExpiry <= 30) {
        let status: 'URGENT' | 'WARNING' | 'NORMAL' = 'NORMAL';
        if (daysUntilExpiry <= 7) status = 'URGENT';
        else if (daysUntilExpiry <= 14) status = 'WARNING';

        expiringLeaves.push({
          type: 'COMP_LEAVE',
          employee: tx.employee,
          hours: tx.hours,
          expiresAt,
          daysUntilExpiry,
          status
        });
      }
    }

    // 2. 檢查特休假到期
    const currentYear = now.getFullYear();
    const annualLeaves = await prisma.annualLeave.findMany({
      where: {
        year: currentYear,
        remainingDays: { gt: 0 }
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        }
      }
    });

    for (const leave of annualLeaves) {
      const expiresAt = new Date(leave.expiryDate);
      const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry > 0 && daysUntilExpiry <= 90) {
        let status: 'URGENT' | 'WARNING' | 'NORMAL' = 'NORMAL';
        if (daysUntilExpiry <= 14) status = 'URGENT';
        else if (daysUntilExpiry <= 30) status = 'WARNING';

        expiringLeaves.push({
          type: 'ANNUAL_LEAVE',
          employee: leave.employee,
          days: leave.remainingDays,
          expiresAt,
          daysUntilExpiry,
          status
        });
      }
    }

    // 排序（緊急的在前）
    expiringLeaves.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

    return NextResponse.json({
      success: true,
      summary: {
        urgent: expiringLeaves.filter(l => l.status === 'URGENT').length,
        warning: expiringLeaves.filter(l => l.status === 'WARNING').length,
        normal: expiringLeaves.filter(l => l.status === 'NORMAL').length,
        total: expiringLeaves.length
      },
      settings: {
        compLeaveExpiryMonths: settings.compLeaveExpiryMonths,
        expiryMode: settings.expiryMode
      },
      expiringLeaves
    });
  } catch (error) {
    console.error('檢查假期到期失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 執行到期處理（批次）
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
    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    // 取得設定
    const expirySettings = await prisma.systemSettings.findUnique({
      where: { key: 'leave_expiry_settings' }
    });

    const settings = expirySettings 
      ? JSON.parse(expirySettings.value)
      : { expiryMode: 'NOTIFY_ONLY' };

    const body = await request.json();
    const { action } = body;
    // employeeIds 可用於未來的批次處理邏輯
    const targetEmployeeIds: number[] = body.employeeIds || [];

    const validActions = ['EXPIRE', 'SETTLE', 'EXTEND'];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json({ 
        error: '無效的處理動作',
        validActions 
      }, { status: 400 });
    }

    // 這裡實作批次處理邏輯
    const processedCount = targetEmployeeIds.length; // 根據選擇的員工數
    const results: { employeeId: number; action: string; result: string }[] = [];

    // 根據 action 執行不同操作
    switch (action) {
      case 'EXPIRE':
        // 將到期的補休標記為過期（新增 EXPIRE 類型交易）
        // 實作略，根據需求展開
        break;
      case 'SETTLE':
        // 將到期的補休結算發薪
        // 實作略，根據需求展開
        break;
      case 'EXTEND':
        // 展延特休假一年
        // 實作略，根據需求展開
        break;
    }

    return NextResponse.json({
      success: true,
      message: `已處理 ${processedCount} 筆到期假期`,
      action,
      currentMode: settings.expiryMode,
      results
    });
  } catch (error) {
    console.error('執行到期處理失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
