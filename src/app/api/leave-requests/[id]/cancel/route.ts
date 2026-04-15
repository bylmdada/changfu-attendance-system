import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { getAnnualLeaveYearBreakdown } from '@/lib/annual-leave';

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

async function approveCancellation(leaveRequest: {
  id: number;
  employeeId: number;
  leaveType?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
}, approverId: number, note: string | null) {
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id: leaveRequest.id },
      data: {
        status: 'CANCELLED',
        cancellationStatus: 'APPROVED',
        cancellationAdminApproverId: approverId,
        cancellationAdminNote: note,
        cancellationApprovedAt: new Date()
      }
    });

    if (
      leaveRequest.leaveType === 'ANNUAL_LEAVE' &&
      leaveRequest.startDate &&
      leaveRequest.endDate
    ) {
      const startDate = new Date(leaveRequest.startDate);
      const endDate = new Date(leaveRequest.endDate);
      for (const { year, days } of getAnnualLeaveYearBreakdown(startDate, endDate)) {
        await tx.annualLeave.updateMany({
          where: {
            employeeId: leaveRequest.employeeId,
            year,
          },
          data: {
            usedDays: { decrement: days },
            remainingDays: { increment: days },
          },
        });
      }
    }
  });
}

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

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const leaveIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!leaveIdResult.isValid || leaveIdResult.value === null) {
      return NextResponse.json({ error: '請假申請 ID 格式錯誤' }, { status: 400 });
    }
    const leaveId = leaveIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的請假撤銷資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的請假撤銷資料' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫撤銷原因' }, { status: 400 });
    }

    // 查找請假申請
    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: leaveId },
      include: {
        employee: {
          select: {
            department: true,
          },
        },
      },
    });

    if (!leaveRequest) {
      return NextResponse.json({ error: '找不到此請假申請' }, { status: 404 });
    }

    // 檢查是否為本人申請
    if (leaveRequest.employeeId !== user.employeeId) {
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

    const user = await getUserFromRequest(request);
    if (!user || !['ADMIN', 'HR', 'MANAGER'].includes(user.role)) {
      return NextResponse.json({ error: '需要主管或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const leaveIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!leaveIdResult.isValid || leaveIdResult.value === null) {
      return NextResponse.json({ error: '請假申請 ID 格式錯誤' }, { status: 400 });
    }
    const leaveId = leaveIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的請假撤銷資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的請假撤銷資料' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action : undefined;
    const opinion = typeof body.opinion === 'string' ? body.opinion : undefined;
    const note = typeof body.note === 'string' ? body.note : undefined;

    const leaveRequest = await prisma.leaveRequest.findUnique({
        where: { id: leaveId },
        include: {
          employee: {
            select: {
              department: true
            }
          }
        }
    });

    if (!leaveRequest) {
      return NextResponse.json({ error: '找不到此請假申請' }, { status: 404 });
    }

    if (!leaveRequest.cancellationStatus) {
      return NextResponse.json({ error: '此申請沒有撤銷請求' }, { status: 400 });
    }

    // 主管/HR 審核（提供意見）
    if ((user.role === 'MANAGER' || user.role === 'HR') && leaveRequest.cancellationStatus === 'PENDING_MANAGER') {
      if (user.role === 'MANAGER') {
        const managedDepartments = await getManagedDepartments(user.employeeId);
        if (
          managedDepartments.length === 0 ||
          !leaveRequest.employee?.department ||
          !managedDepartments.includes(leaveRequest.employee.department)
        ) {
          return NextResponse.json({ error: '無權限審核此部門的撤銷申請' }, { status: 403 });
        }
      }

      if (!['AGREE', 'DISAGREE'].includes(opinion ?? '')) {
        return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
      }

      await prisma.leaveRequest.update({
        where: { id: leaveId },
        data: {
          cancellationStatus: 'PENDING_ADMIN',
          cancellationHRReviewerId: user.employeeId,
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
    if (user.role === 'ADMIN' && leaveRequest.cancellationStatus === 'PENDING_ADMIN') {
      if (!['APPROVE', 'REJECT'].includes(action ?? '')) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      if (action === 'APPROVE') {
        await approveCancellation(leaveRequest, user.employeeId, note || null);

        return NextResponse.json({
          success: true,
          message: '撤銷申請已核准，請假已取消'
        });
      } else {
        await prisma.leaveRequest.update({
          where: { id: leaveId },
          data: {
            cancellationStatus: 'REJECTED',
            cancellationAdminApproverId: user.employeeId,
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
    if (user.role === 'ADMIN' && leaveRequest.cancellationStatus === 'PENDING_MANAGER') {
      if (!['APPROVE', 'REJECT'].includes(action ?? '')) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      if (action === 'APPROVE') {
        await approveCancellation(leaveRequest, user.employeeId, note || null);

        return NextResponse.json({
          success: true,
          message: '撤銷申請已核准，請假已取消'
        });
      } else {
        await prisma.leaveRequest.update({
          where: { id: leaveId },
          data: {
            cancellationStatus: 'REJECTED',
            cancellationAdminApproverId: user.employeeId,
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
