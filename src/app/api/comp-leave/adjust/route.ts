'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// POST - 手動調整員工補休餘額
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: csrfResult.error || 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!['ADMIN', 'HR'].includes(user.role)) {
      return NextResponse.json({ error: '需要管理員或人資權限' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      const error = parsedBody.error === 'empty_body'
        ? '請提供有效的補休調整資料'
        : '無效的 JSON 格式';
      return NextResponse.json({ error }, { status: 400 });
    }

    if (!isPlainObject(parsedBody.data)) {
      const error = '請提供有效的補休調整資料';
      return NextResponse.json({ error }, { status: 400 });
    }

    const body = parsedBody.data;
    const rawEmployeeId = body.employeeId;
    const employeeId = typeof rawEmployeeId === 'number'
      ? rawEmployeeId
      : typeof rawEmployeeId === 'string' && rawEmployeeId.trim()
        ? Number(rawEmployeeId)
        : NaN;
    const type = body.type === 'add' || body.type === 'subtract' ? body.type : '';
    const hours = typeof body.hours === 'number'
      ? body.hours
      : typeof body.hours === 'string' && body.hours.trim()
        ? Number(body.hours)
        : NaN;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!Number.isInteger(employeeId) || employeeId <= 0 || !type || !Number.isFinite(hours) || !reason) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const adjustHours = hours;
    if (adjustHours <= 0) {
      return NextResponse.json({ error: '無效的時數' }, { status: 400 });
    }

    // 取得當前年月
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 使用交易確保資料一致性
    const result = await prisma.$transaction(async (tx) => {
      // 取得或建立餘額記錄
      let balance = await tx.compLeaveBalance.findUnique({
        where: { employeeId }
      });

      if (!balance) {
        balance = await tx.compLeaveBalance.create({
          data: { employeeId }
        });
      }

      // 計算新餘額
      let newTotalEarned = balance.totalEarned;
      let newTotalUsed = balance.totalUsed;
      let transactionType: string;

      if (type === 'add') {
        newTotalEarned += adjustHours;
        transactionType = 'EARN';
      } else {
        newTotalUsed += adjustHours;
        transactionType = 'USE';
      }

      const newBalance = newTotalEarned - newTotalUsed;

      if (newBalance < 0) {
        throw new Error('調整後餘額不可為負數');
      }

      // 更新餘額
      const updatedBalance = await tx.compLeaveBalance.update({
        where: { employeeId },
        data: {
          totalEarned: newTotalEarned,
          totalUsed: newTotalUsed,
          balance: newBalance
        }
      });

      // 建立交易記錄
      await tx.compLeaveTransaction.create({
        data: {
          employeeId,
          transactionType,
          hours: adjustHours,
          isFrozen: true,
          referenceType: 'ADJUSTMENT',
          yearMonth,
          description: `[手動調整] ${reason}`
        }
      });

      return updatedBalance;
    });

    return NextResponse.json({
      success: true,
      message: '調整成功',
      balance: result
    });

  } catch (error) {
    console.error('調整補休餘額失敗:', error);
    if (error instanceof Error && error.message.includes('負數')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
