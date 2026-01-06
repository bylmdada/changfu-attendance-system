import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// 回沖補休時數
async function reverseCompLeave(employeeId: number, hours: number, overtimeRequestId: number) {
  try {
    const balance = await prisma.compLeaveBalance.findUnique({
      where: { employeeId }
    });

    if (!balance) {
      console.log(`員工 ${employeeId} 沒有補休餘額記錄`);
      return false;
    }

    await prisma.compLeaveBalance.update({
      where: { employeeId },
      data: {
        totalEarned: { decrement: hours },
        balance: { decrement: hours }
      }
    });

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    
    await prisma.compLeaveTransaction.create({
      data: {
        employeeId,
        transactionType: 'ADJUST',
        hours: -hours,
        isFrozen: true,
        referenceType: 'OVERTIME_VOID',
        referenceId: overtimeRequestId,
        description: `加班作廢回沖 (加班申請 #${overtimeRequestId})`,
        yearMonth
      }
    });

    return true;
  } catch (error) {
    console.error('回沖補休失敗:', error);
    return false;
  }
}

// POST: ADMIN/HR 直接作廢加班申請
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: '請求太頻繁' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要 HR 或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const overtimeId = parseInt(id);

    const body = await request.json();
    const { reason } = body;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫作廢原因' }, { status: 400 });
    }

    const overtimeRequest = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeId }
    });

    if (!overtimeRequest) {
      return NextResponse.json({ error: '找不到此加班申請' }, { status: 404 });
    }

    if (overtimeRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能作廢已核准的申請' }, { status: 400 });
    }

    // 回沖補休（如果是補休類型）
    let compLeaveReversed = false;
    if (overtimeRequest.compensationType === 'COMP_LEAVE') {
      compLeaveReversed = await reverseCompLeave(
        overtimeRequest.employeeId,
        overtimeRequest.totalHours,
        overtimeId
      );
    }

    // 直接作廢
    await prisma.overtimeRequest.update({
      where: { id: overtimeId },
      data: {
        status: 'VOIDED',
        voidedBy: decoded.employeeId,
        voidedAt: new Date(),
        voidReason: reason.trim(),
        compLeaveReversed,
        compLeaveReversedAt: compLeaveReversed ? new Date() : null
      }
    });

    return NextResponse.json({
      success: true,
      message: compLeaveReversed 
        ? '加班申請已作廢，補休已回沖' 
        : '加班申請已作廢'
    });
  } catch (error) {
    console.error('作廢加班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
