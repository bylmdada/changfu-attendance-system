import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type CompLeaveTransactionRecord = {
  id: number;
  transactionType: string;
  hours: number;
  isFrozen: boolean;
  referenceType: string | null;
  createdAt: Date;
};

function isAfterBaseline(
  transaction: CompLeaveTransactionRecord,
  baseline: CompLeaveTransactionRecord | null
) {
  if (!baseline) {
    return true;
  }

  const transactionTime = transaction.createdAt.getTime();
  const baselineTime = baseline.createdAt.getTime();

  if (transactionTime !== baselineTime) {
    return transactionTime > baselineTime;
  }

  return transaction.id > baseline.id;
}

function getLatestImportBaseline(transactions: CompLeaveTransactionRecord[]) {
  return transactions
    .filter(transaction => transaction.transactionType === 'EARN' && transaction.referenceType === 'IMPORT')
    .sort((left, right) => {
      const timeDiff = right.createdAt.getTime() - left.createdAt.getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return right.id - left.id;
    })[0] ?? null;
}

// GET - 取得員工補休餘額
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let targetEmployeeId = user.employeeId;
    
    // 管理員可以查看其他員工
    if (['ADMIN', 'HR'].includes(user.role) && searchParams.get('employeeId')) {
      targetEmployeeId = parseInt(searchParams.get('employeeId')!);
    }

    // 取得或建立餘額記錄
    let balance = await prisma.compLeaveBalance.findUnique({
      where: { employeeId: targetEmployeeId }
    });

    if (!balance) {
      balance = await prisma.compLeaveBalance.create({
        data: { employeeId: targetEmployeeId }
      });
    }

    // 取得最近交易明細
    const recentTransactions = await prisma.compLeaveTransaction.findMany({
      where: { employeeId: targetEmployeeId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    // 計算待確認餘額
    const pendingBalance = balance.pendingEarn - balance.pendingUse;
    const confirmedBalance = balance.totalEarned - balance.totalUsed;
    const availableBalance = confirmedBalance + pendingBalance;

    return NextResponse.json({
      success: true,
      balance: {
        id: balance.id,
        employeeId: balance.employeeId,
        confirmedBalance,      // 已凍結確認餘額
        pendingEarn: balance.pendingEarn,   // 待確認獲得
        pendingUse: balance.pendingUse,     // 待確認使用
        pendingBalance,        // 待確認淨餘額
        availableBalance,      // 可用餘額（確認 + 待確認）
        totalEarned: balance.totalEarned,
        totalUsed: balance.totalUsed,
        updatedAt: balance.updatedAt
      },
      recentTransactions
    });
  } catch (error) {
    console.error('取得補休餘額失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 計算並更新特定員工的補休餘額（考勤凍結時呼叫）
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!['ADMIN', 'HR'].includes(user.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: csrfResult.error || 'CSRF validation failed' },
        { status: 403 }
      );
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的補休餘額更新資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的補休餘額更新資料' }, { status: 400 });
    }

    const rawEmployeeId = body.employeeId;
    const employeeId = typeof rawEmployeeId === 'number'
      ? rawEmployeeId
      : typeof rawEmployeeId === 'string' && rawEmployeeId.trim()
        ? Number(rawEmployeeId)
        : NaN;
    const yearMonth = typeof body.yearMonth === 'string' ? body.yearMonth.trim() : '';

    if (!Number.isInteger(employeeId) || employeeId <= 0 || !yearMonth) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const balance = await prisma.$transaction(async (tx) => {
      await tx.compLeaveTransaction.updateMany({
        where: {
          employeeId,
          yearMonth,
          isFrozen: false
        },
        data: { isFrozen: true }
      });

      const transactions = await tx.compLeaveTransaction.findMany({
        where: { employeeId }
      });

      const allTransactions = transactions as CompLeaveTransactionRecord[];
      const frozenTransactions = allTransactions.filter(transaction => transaction.isFrozen);
      const pendingTransactions = allTransactions.filter(transaction => !transaction.isFrozen);
      const latestImportBaseline = getLatestImportBaseline(frozenTransactions);

      const effectiveFrozenTransactions = latestImportBaseline
        ? frozenTransactions.filter(transaction => {
            if (transaction.id === latestImportBaseline.id) {
              return true;
            }

            if (transaction.referenceType === 'IMPORT') {
              return false;
            }

            return isAfterBaseline(transaction, latestImportBaseline);
          })
        : frozenTransactions;

      const effectivePendingTransactions = latestImportBaseline
        ? pendingTransactions.filter(transaction => isAfterBaseline(transaction, latestImportBaseline))
        : pendingTransactions;

      const totalEarned = effectiveFrozenTransactions
        .filter(t => t.transactionType === 'EARN')
        .reduce((sum, t) => sum + t.hours, 0);

      const totalUsed = effectiveFrozenTransactions
        .filter(t => t.transactionType === 'USE')
        .reduce((sum, t) => sum + t.hours, 0);

      const pendingEarn = effectivePendingTransactions
        .filter(t => t.transactionType === 'EARN')
        .reduce((sum, t) => sum + t.hours, 0);

      const pendingUse = effectivePendingTransactions
        .filter(t => t.transactionType === 'USE')
        .reduce((sum, t) => sum + t.hours, 0);

      return tx.compLeaveBalance.upsert({
        where: { employeeId },
        update: {
          totalEarned,
          totalUsed,
          balance: totalEarned - totalUsed,
          pendingEarn,
          pendingUse
        },
        create: {
          employeeId,
          totalEarned,
          totalUsed,
          balance: totalEarned - totalUsed,
          pendingEarn,
          pendingUse
        }
      });
    });

    return NextResponse.json({
      success: true,
      message: '補休餘額已更新',
      balance
    });
  } catch (error) {
    console.error('更新補休餘額失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
