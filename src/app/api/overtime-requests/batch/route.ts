import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';

/**
 * POST - 批量審核加班申請
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
        const overtimeRequest = await prisma.overtimeRequest.findUnique({
          where: { id: parseInt(id) },
          include: { employee: true }
        });

        if (!overtimeRequest) {
          results.errors.push(`ID ${id}: 申請不存在`);
          results.failedCount++;
          continue;
        }

        if (overtimeRequest.status !== 'PENDING') {
          results.errors.push(`ID ${id}: 申請已被處理`);
          results.failedCount++;
          continue;
        }

        // 更新申請狀態（注意：OvertimeRequest 沒有 rejectReason 欄位）
        await prisma.overtimeRequest.update({
          where: { id: parseInt(id) },
          data: {
            status: action,
            approvedBy: user.userId,
            approvedAt: new Date()
          }
        });

        // 如果核准且補償方式為補休，更新補休餘額
        if (action === 'APPROVED' && overtimeRequest.compensationType === 'COMP_LEAVE') {
          const hours = overtimeRequest.totalHours;
          const yearMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
          
          // 檢查是否有補休餘額記錄
          const balance = await prisma.compLeaveBalance.findUnique({
            where: { employeeId: overtimeRequest.employeeId }
          });

          if (!balance) {
            // 建立新的補休餘額記錄
            await prisma.compLeaveBalance.create({
              data: {
                employeeId: overtimeRequest.employeeId,
                totalEarned: hours,
                totalUsed: 0,
                balance: hours,
                pendingEarn: 0,
                pendingUse: 0
              }
            });
          } else {
            // 更新現有餘額
            await prisma.compLeaveBalance.update({
              where: { employeeId: overtimeRequest.employeeId },
              data: {
                totalEarned: { increment: hours },
                balance: { increment: hours }
              }
            });
          }

          // 記錄補休交易（使用正確欄位名稱）
          await prisma.compLeaveTransaction.create({
            data: {
              employeeId: overtimeRequest.employeeId,
              transactionType: 'EARN',
              hours: hours,
              isFrozen: true,
              referenceId: overtimeRequest.id,
              referenceType: 'OVERTIME',
              yearMonth: yearMonth,
              description: `加班核准 - ${new Date(overtimeRequest.overtimeDate).toLocaleDateString('zh-TW')}`
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
    console.error('批量審核加班失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
