import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// POST - 批次審核請假申請
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || (decoded.role !== 'ADMIN' && decoded.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { ids, action, remarks } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: '無效的審核操作' }, { status: 400 });
    }

    // 批次更新請假申請
    const updateResult = await prisma.leaveRequest.updateMany({
      where: {
        id: { in: ids.map((id: number | string) => parseInt(String(id))) },
        status: 'PENDING'
      },
      data: {
        status: action,
        approvedBy: decoded.employeeId,
        approvedAt: new Date(),
        ...(remarks && { rejectReason: action === 'REJECTED' ? remarks : null })
      }
    });

    return NextResponse.json({
      success: true,
      message: `已${action === 'APPROVED' ? '批准' : '拒絕'} ${updateResult.count} 筆請假申請`,
      count: updateResult.count
    });
  } catch (error) {
    console.error('批次審核請假申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
