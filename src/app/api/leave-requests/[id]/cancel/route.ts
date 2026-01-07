import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// POST: 員工申請撤銷
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
    const leaveId = parseInt(id);

    const body = await request.json();
    const { reason } = body;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫撤銷原因' }, { status: 400 });
    }

    // 查找請假申請
    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: leaveId }
    });

    if (!leaveRequest) {
      return NextResponse.json({ error: '找不到此請假申請' }, { status: 404 });
    }

    // 檢查是否為本人申請
    if (leaveRequest.employeeId !== decoded.employeeId) {
      return NextResponse.json({ error: '只能撤銷自己的申請' }, { status: 403 });
    }

    // 檢查狀態是否為已核准
    if (leaveRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能撤銷已核准的申請' }, { status: 400 });
    }

    // 檢查是否已有撤銷申請
    if (leaveRequest.cancellationStatus) {
      return NextResponse.json({ error: '已有撤銷申請進行中' }, { status: 400 });
    }

    // 建立撤銷申請
    await prisma.leaveRequest.update({
      where: { id: leaveId },
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
    console.error('撤銷申請失敗:', error);
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
    const leaveId = parseInt(id);

    const body = await request.json();
    const { action, opinion, note } = body;

    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: leaveId }
    });

    if (!leaveRequest) {
      return NextResponse.json({ error: '找不到此請假申請' }, { status: 404 });
    }

    if (!leaveRequest.cancellationStatus) {
      return NextResponse.json({ error: '此申請沒有撤銷請求' }, { status: 400 });
    }

    // 主管/HR 審核（提供意見）
    if ((decoded.role === 'MANAGER' || decoded.role === 'HR') && leaveRequest.cancellationStatus === 'PENDING_MANAGER') {
      if (!['AGREE', 'DISAGREE'].includes(opinion)) {
        return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
      }

      await prisma.leaveRequest.update({
        where: { id: leaveId },
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
    if (decoded.role === 'ADMIN' && leaveRequest.cancellationStatus === 'PENDING_ADMIN') {
      if (!['APPROVE', 'REJECT'].includes(action)) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      if (action === 'APPROVE') {
        await prisma.leaveRequest.update({
          where: { id: leaveId },
          data: {
            status: 'CANCELLED',
            cancellationStatus: 'APPROVED',
            cancellationAdminApproverId: decoded.employeeId,
            cancellationAdminNote: note || null,
            cancellationApprovedAt: new Date()
          }
        });

        return NextResponse.json({
          success: true,
          message: '撤銷申請已核准，請假已取消'
        });
      } else {
        await prisma.leaveRequest.update({
          where: { id: leaveId },
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

    // Admin 也可以直接審核 PENDING_MANAGER 狀態
    if (decoded.role === 'ADMIN' && leaveRequest.cancellationStatus === 'PENDING_MANAGER') {
      if (!['APPROVE', 'REJECT'].includes(action)) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      if (action === 'APPROVE') {
        await prisma.leaveRequest.update({
          where: { id: leaveId },
          data: {
            status: 'CANCELLED',
            cancellationStatus: 'APPROVED',
            cancellationAdminApproverId: decoded.employeeId,
            cancellationAdminNote: note || null,
            cancellationApprovedAt: new Date()
          }
        });

        return NextResponse.json({
          success: true,
          message: '撤銷申請已核准，請假已取消'
        });
      } else {
        await prisma.leaveRequest.update({
          where: { id: leaveId },
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
    console.error('審核撤銷申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
