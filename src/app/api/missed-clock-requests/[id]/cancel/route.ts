import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function getManagedDepartments(employeeId: number): Promise<string[]> {
  const records = await prisma.departmentManager.findMany({
    where: {
      employeeId,
      isActive: true,
    },
    select: { department: true },
  });

  return records.map((record) => record.department).filter(Boolean);
}

// POST: 員工申請撤銷補卡
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

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const parsedRequestId = parseIntegerQueryParam(id, { min: 1 });
    if (!parsedRequestId.isValid || parsedRequestId.value === null) {
      return NextResponse.json({ error: '申請ID格式錯誤' }, { status: 400 });
    }
    const requestId = parsedRequestId.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的補卡撤銷資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的補卡撤銷資料' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫撤銷原因' }, { status: 400 });
    }

    const missedClockRequest = await prisma.missedClockRequest.findUnique({
      where: { id: requestId },
      include: {
        employee: {
          select: { department: true },
        },
      },
    });

    if (!missedClockRequest) {
      return NextResponse.json({ error: '找不到此補卡申請' }, { status: 404 });
    }

    if (missedClockRequest.employeeId !== decoded.employeeId) {
      return NextResponse.json({ error: '只能撤銷自己的申請' }, { status: 403 });
    }

    if (missedClockRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能撤銷已核准的申請' }, { status: 400 });
    }

    if (missedClockRequest.cancellationStatus) {
      return NextResponse.json({ error: '已有撤銷申請進行中' }, { status: 400 });
    }

    await prisma.missedClockRequest.update({
      where: { id: requestId },
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
    console.error('撤銷補卡申請失敗:', error);
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

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (!['ADMIN', 'MANAGER'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要主管或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const parsedRequestId = parseIntegerQueryParam(id, { min: 1 });
    if (!parsedRequestId.isValid || parsedRequestId.value === null) {
      return NextResponse.json({ error: '申請ID格式錯誤' }, { status: 400 });
    }
    const requestId = parsedRequestId.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的補卡撤銷資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的補卡撤銷資料' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action : undefined;
    const opinion = typeof body.opinion === 'string' ? body.opinion : undefined;
    const note = typeof body.note === 'string' ? body.note : undefined;

    const missedClockRequest = await prisma.missedClockRequest.findUnique({
      where: { id: requestId },
      include: {
        employee: {
          select: { department: true },
        },
      },
    });

    if (!missedClockRequest) {
      return NextResponse.json({ error: '找不到此補卡申請' }, { status: 404 });
    }

    if (!missedClockRequest.cancellationStatus) {
      return NextResponse.json({ error: '此申請沒有撤銷請求' }, { status: 400 });
    }

    // 主管審核
    if (decoded.role === 'MANAGER' && missedClockRequest.cancellationStatus === 'PENDING_MANAGER') {
      const managedDepartments = await getManagedDepartments(decoded.employeeId);
      if (
        managedDepartments.length === 0 ||
        !missedClockRequest.employee?.department ||
        !managedDepartments.includes(missedClockRequest.employee.department)
      ) {
        return NextResponse.json({ error: '無權限審核此部門的補卡撤銷申請' }, { status: 403 });
      }

      if (!['AGREE', 'DISAGREE'].includes(opinion ?? '')) {
        return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
      }

      await prisma.missedClockRequest.update({
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
        message: '主管審核完成，已轉交管理員決核'
      });
    }

    // Admin 決核
    if (decoded.role === 'ADMIN' && 
        (missedClockRequest.cancellationStatus === 'PENDING_ADMIN' || 
         missedClockRequest.cancellationStatus === 'PENDING_MANAGER')) {
      if (!['APPROVE', 'REJECT'].includes(action ?? '')) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      if (action === 'APPROVE') {
        await prisma.missedClockRequest.update({
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
          message: '撤銷申請已核准，補卡已取消'
        });
      } else {
        await prisma.missedClockRequest.update({
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
    console.error('審核補卡撤銷申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
