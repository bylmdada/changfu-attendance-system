import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';

/**
 * POST - 批量審核請假申請
 */
export async function POST(request: NextRequest) {
  try {
    // 驗證登入
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    const user = await getUserFromToken(token);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有 ADMIN 和 HR 可以批量審核
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { ids, action } = body;

    // 驗證參數
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: '無效的審核動作' }, { status: 400 });
    }

    const results = {
      successCount: 0,
      failedCount: 0,
      errors: [] as string[]
    };

    // 批量處理
    for (const id of ids) {
      try {
        // 檢查申請是否存在且為待審核狀態
        const leaveRequest = await prisma.leaveRequest.findUnique({
          where: { id: parseInt(id) },
          include: { employee: true }
        });

        if (!leaveRequest) {
          results.errors.push(`ID ${id}: 申請不存在`);
          results.failedCount++;
          continue;
        }

        if (leaveRequest.status !== 'PENDING') {
          results.errors.push(`ID ${id}: 申請已被處理`);
          results.failedCount++;
          continue;
        }

        // 更新申請狀態
        await prisma.leaveRequest.update({
          where: { id: parseInt(id) },
          data: {
            status: action,
            approvedBy: user.userId,
            approvedAt: new Date()
          }
        });

        // 如果核准，可能需要扣除年假餘額
        if (action === 'APPROVED' && leaveRequest.leaveType === 'ANNUAL_LEAVE') {
          // 計算請假天數
          const startDate = new Date(leaveRequest.startDate);
          const endDate = new Date(leaveRequest.endDate);
          const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          
          // 更新年假餘額
          const year = startDate.getFullYear();
          await prisma.annualLeave.updateMany({
            where: {
              employeeId: leaveRequest.employeeId,
              year: year
            },
            data: {
              usedDays: { increment: diffDays },
              remainingDays: { decrement: diffDays }
            }
          });
        }

        results.successCount++;
      } catch (error) {
        console.error(`處理 ID ${id} 失敗:`, error);
        results.errors.push(`ID ${id}: 處理失敗`);
        results.failedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `批量審核完成：成功 ${results.successCount} 筆，失敗 ${results.failedCount} 筆`,
      ...results
    });
  } catch (error) {
    console.error('批量審核請假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
