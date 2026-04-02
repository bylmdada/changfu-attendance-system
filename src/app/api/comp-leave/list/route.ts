'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

// GET - 取得所有員工的補休餘額列表
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

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const department = searchParams.get('department');

    // 一般員工只能看自己的
    if (!['ADMIN', 'HR'].includes(decoded.role)) {
      const balance = await prisma.compLeaveBalance.findUnique({
        where: { employeeId: decoded.employeeId },
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

      return NextResponse.json({
        success: true,
        balances: balance ? [balance] : []
      });
    }

    // ADMIN/HR 可以看所有員工
    // 先獲取所有在職員工
    const employees = await prisma.employee.findMany({
      where: {
        isActive: true,
        ...(department ? { department } : {})
      },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true
      },
      orderBy: [
        { department: 'asc' },
        { name: 'asc' }
      ]
    });

    // 獲取所有補休餘額
    const existingBalances = await prisma.compLeaveBalance.findMany({
      where: {
        employeeId: { in: employees.map(e => e.id) }
      }
    });

    const balanceMap = new Map(existingBalances.map(b => [b.employeeId, b]));

    // 合併資料，沒有餘額記錄的員工顯示為 0
    const balances = employees.map(employee => {
      const balance = balanceMap.get(employee.id);
      return {
        id: balance?.id || 0,
        employeeId: employee.id,
        totalEarned: balance?.totalEarned || 0,
        totalUsed: balance?.totalUsed || 0,
        balance: balance?.balance || 0,
        pendingEarn: balance?.pendingEarn || 0,
        pendingUse: balance?.pendingUse || 0,
        updatedAt: balance?.updatedAt || new Date(),
        employee
      };
    });

    return NextResponse.json({
      success: true,
      balances
    });

  } catch (error) {
    console.error('取得補休餘額列表失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
