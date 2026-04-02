import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// POST: ADMIN/HR 直接作廢請假申請
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

    const decoded = await getUserFromToken(token);
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要 HR 或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const leaveId = parseInt(id);

    const body = await request.json();
    const { reason } = body;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫作廢原因' }, { status: 400 });
    }

    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: leaveId }
    });

    if (!leaveRequest) {
      return NextResponse.json({ error: '找不到此請假申請' }, { status: 404 });
    }

    // 檢查狀態是否為已核准
    if (leaveRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能作廢已核准的申請' }, { status: 400 });
    }

    // 直接作廢
    await prisma.leaveRequest.update({
      where: { id: leaveId },
      data: {
        status: 'VOIDED',
        voidedBy: decoded.employeeId,
        voidedAt: new Date(),
        voidReason: reason.trim()
      }
    });

    return NextResponse.json({
      success: true,
      message: '請假申請已作廢'
    });
  } catch (error) {
    console.error('作廢請假申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
