import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getTaiwanYearMonth } from '@/lib/timezone';

// 回沖補休時數
async function reverseCompLeave(employeeId: number, hours: number, overtimeRequestId: number) {
  try {
    // 取得員工補休餘額
    const balance = await prisma.compLeaveBalance.findUnique({
      where: { employeeId }
    });

    if (!balance) {
      console.log(`員工 ${employeeId} 沒有補休餘額記錄`);
      return false;
    }

    // 計算要扣減的時數
    const hoursToDeduct = hours;
    
    // 更新餘額
    await prisma.compLeaveBalance.update({
      where: { employeeId },
      data: {
        totalEarned: { decrement: hoursToDeduct },
        balance: { decrement: hoursToDeduct }
      }
    });

    // 建立扣減交易記錄
    const yearMonth = getTaiwanYearMonth();
    
    await prisma.compLeaveTransaction.create({
      data: {
        employeeId,
        transactionType: 'ADJUST',
        hours: -hoursToDeduct,
        isFrozen: true,
        referenceType: 'OVERTIME_CANCEL',
        referenceId: overtimeRequestId,
        description: `加班撤銷回沖 (加班申請 #${overtimeRequestId})`,
        yearMonth
      }
    });

    console.log(`已回沖員工 ${employeeId} 的補休 ${hoursToDeduct} 小時`);
    return true;
  } catch (error) {
    console.error('回沖補休失敗:', error);
    return false;
  }
}

// POST: 員工申請撤銷加班
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
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證' }, { status: 401 });
    }

    const { id } = await params;
    const overtimeId = parseInt(id);

    const body = await request.json();
    const { reason } = body;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫撤銷原因' }, { status: 400 });
    }

    const overtimeRequest = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeId }
    });

    if (!overtimeRequest) {
      return NextResponse.json({ error: '找不到此加班申請' }, { status: 404 });
    }

    // 檢查是否為本人申請
    if (overtimeRequest.employeeId !== decoded.employeeId) {
      return NextResponse.json({ error: '只能撤銷自己的申請' }, { status: 403 });
    }

    // 檢查狀態是否為已核准
    if (overtimeRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能撤銷已核准的申請' }, { status: 400 });
    }

    // 檢查是否已有撤銷申請
    if (overtimeRequest.cancellationStatus) {
      return NextResponse.json({ error: '已有撤銷申請進行中' }, { status: 400 });
    }

    // 建立撤銷申請
    await prisma.overtimeRequest.update({
      where: { id: overtimeId },
      data: {
        cancellationStatus: 'PENDING_MANAGER',
        cancellationReason: reason.trim(),
        cancellationRequestedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      message: '撤銷申請已送出，請等待部門主管審核'
    });
  } catch (error) {
    console.error('撤銷加班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT: 主管/Admin 審核撤銷申請
export async function PUT(
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
    if (!decoded || !['ADMIN', 'HR', 'MANAGER'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要主管或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const overtimeId = parseInt(id);

    const body = await request.json();
    const { action, opinion, note } = body;

    const overtimeRequest = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeId }
    });

    if (!overtimeRequest) {
      return NextResponse.json({ error: '找不到此加班申請' }, { status: 404 });
    }

    if (!overtimeRequest.cancellationStatus) {
      return NextResponse.json({ error: '此申請沒有撤銷請求' }, { status: 400 });
    }

    // 主管/HR 審核（提供意見）
    if ((decoded.role === 'MANAGER' || decoded.role === 'HR') && overtimeRequest.cancellationStatus === 'PENDING_MANAGER') {
      if (!['AGREE', 'DISAGREE'].includes(opinion)) {
        return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
      }

      await prisma.overtimeRequest.update({
        where: { id: overtimeId },
        data: {
          cancellationStatus: 'PENDING_ADMIN',
          cancellationHRReviewerId: decoded.employeeId,
          cancellationHROpinion: opinion,
          cancellationHRNote: note || null,
          cancellationHRReviewedAt: new Date()
        }
      });

      return NextResponse.json({
        success: true,
        message: '主管審核完成，已轉交管理員決核'
      });
    }

    // Admin 決核
    if (decoded.role === 'ADMIN' && 
        (overtimeRequest.cancellationStatus === 'PENDING_ADMIN' || 
         overtimeRequest.cancellationStatus === 'PENDING_MANAGER')) {
      if (!['APPROVE', 'REJECT'].includes(action)) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      if (action === 'APPROVE') {
        // 回沖補休（如果是補休類型）
        let compLeaveReversed = false;
        if (overtimeRequest.compensationType === 'COMP_LEAVE') {
          compLeaveReversed = await reverseCompLeave(
            overtimeRequest.employeeId,
            overtimeRequest.totalHours,
            overtimeId
          );
        }

        await prisma.overtimeRequest.update({
          where: { id: overtimeId },
          data: {
            status: 'CANCELLED',
            cancellationStatus: 'APPROVED',
            cancellationAdminApproverId: decoded.employeeId,
            cancellationAdminNote: note || null,
            cancellationApprovedAt: new Date(),
            compLeaveReversed,
            compLeaveReversedAt: compLeaveReversed ? new Date() : null
          }
        });

        return NextResponse.json({
          success: true,
          message: compLeaveReversed 
            ? '撤銷申請已核准，加班已取消，補休已回沖' 
            : '撤銷申請已核准，加班已取消'
        });
      } else {
        await prisma.overtimeRequest.update({
          where: { id: overtimeId },
          data: {
            cancellationStatus: 'REJECTED',
            cancellationAdminApproverId: decoded.employeeId,
            cancellationAdminNote: note || null,
            cancellationApprovedAt: new Date()
          }
        });

        return NextResponse.json({
          success: true,
          message: '撤銷申請已駁回'
        });
      }
    }

    return NextResponse.json({ error: '無法處理此狀態的申請' }, { status: 400 });
  } catch (error) {
    console.error('審核加班撤銷申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
