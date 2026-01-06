import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// POST: 員工申請撤銷調班
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
    const requestId = parseInt(id);

    const body = await request.json();
    const { reason } = body;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫撤銷原因' }, { status: 400 });
    }

    const shiftExchangeRequest = await prisma.shiftExchangeRequest.findUnique({
      where: { id: requestId }
    });

    if (!shiftExchangeRequest) {
      return NextResponse.json({ error: '找不到此調班申請' }, { status: 404 });
    }

    if (shiftExchangeRequest.requesterId !== decoded.employeeId) {
      return NextResponse.json({ error: '只能撤銷自己的申請' }, { status: 403 });
    }

    if (shiftExchangeRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能撤銷已核准的申請' }, { status: 400 });
    }

    if (shiftExchangeRequest.cancellationStatus) {
      return NextResponse.json({ error: '已有撤銷申請進行中' }, { status: 400 });
    }

    await prisma.shiftExchangeRequest.update({
      where: { id: requestId },
      data: {
        cancellationStatus: 'PENDING_HR',
        cancellationReason: reason.trim(),
        cancellationRequestedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      message: '撤銷申請已送出，請等待 HR 審核'
    });
  } catch (error) {
    console.error('撤銷調班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT: HR/Admin 審核撤銷申請
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
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要 HR 或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const requestId = parseInt(id);

    const body = await request.json();
    const { action, opinion, note } = body;

    const shiftExchangeRequest = await prisma.shiftExchangeRequest.findUnique({
      where: { id: requestId }
    });

    if (!shiftExchangeRequest) {
      return NextResponse.json({ error: '找不到此調班申請' }, { status: 404 });
    }

    if (!shiftExchangeRequest.cancellationStatus) {
      return NextResponse.json({ error: '此申請沒有撤銷請求' }, { status: 400 });
    }

    // HR 審核
    if (decoded.role === 'HR' && shiftExchangeRequest.cancellationStatus === 'PENDING_HR') {
      if (!['AGREE', 'DISAGREE'].includes(opinion)) {
        return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
      }

      await prisma.shiftExchangeRequest.update({
        where: { id: requestId },
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
        message: 'HR 審核完成，已轉交管理員決核'
      });
    }

    // Admin 決核
    if (decoded.role === 'ADMIN' && 
        (shiftExchangeRequest.cancellationStatus === 'PENDING_ADMIN' || 
         shiftExchangeRequest.cancellationStatus === 'PENDING_HR')) {
      if (!['APPROVE', 'REJECT'].includes(action)) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      if (action === 'APPROVE') {
        await prisma.shiftExchangeRequest.update({
          where: { id: requestId },
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
          message: '撤銷申請已核准，調班已取消'
        });
      } else {
        await prisma.shiftExchangeRequest.update({
          where: { id: requestId },
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
    console.error('審核調班撤銷申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
