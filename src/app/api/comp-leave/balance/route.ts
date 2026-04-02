import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

// GET - 取得員工補休餘額
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let targetEmployeeId = decoded.employeeId;
    
    // 管理員可以查看其他員工
    if (['ADMIN', 'HR'].includes(decoded.role) && searchParams.get('employeeId')) {
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

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, yearMonth } = body;

    if (!employeeId || !yearMonth) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 將該月份的交易標記為已凍結
    await prisma.compLeaveTransaction.updateMany({
      where: {
        employeeId: parseInt(employeeId),
        yearMonth,
        isFrozen: false
      },
      data: { isFrozen: true }
    });

    // 重新計算餘額
    const transactions = await prisma.compLeaveTransaction.findMany({
      where: { employeeId: parseInt(employeeId) }
    });

    const frozenTransactions = transactions.filter(t => t.isFrozen);
    const pendingTransactions = transactions.filter(t => !t.isFrozen);

    const totalEarned = frozenTransactions
      .filter(t => t.transactionType === 'EARN')
      .reduce((sum, t) => sum + t.hours, 0);
    
    const totalUsed = frozenTransactions
      .filter(t => t.transactionType === 'USE')
      .reduce((sum, t) => sum + t.hours, 0);

    const pendingEarn = pendingTransactions
      .filter(t => t.transactionType === 'EARN')
      .reduce((sum, t) => sum + t.hours, 0);

    const pendingUse = pendingTransactions
      .filter(t => t.transactionType === 'USE')
      .reduce((sum, t) => sum + t.hours, 0);

    // 更新餘額
    const balance = await prisma.compLeaveBalance.upsert({
      where: { employeeId: parseInt(employeeId) },
      update: {
        totalEarned,
        totalUsed,
        balance: totalEarned - totalUsed,
        pendingEarn,
        pendingUse
      },
      create: {
        employeeId: parseInt(employeeId),
        totalEarned,
        totalUsed,
        balance: totalEarned - totalUsed,
        pendingEarn,
        pendingUse
      }
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
