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

// 回沖補休時數
async function reverseCompLeave(
  tx: Pick<typeof prisma, 'compLeaveBalance' | 'compLeaveTransaction'>,
  employeeId: number,
  hours: number,
  overtimeRequestId: number
) {
  // 取得員工補休餘額
  const balance = await tx.compLeaveBalance.findUnique({
    where: { employeeId }
  });

  if (!balance) {
    console.log(`員工 ${employeeId} 沒有補休餘額記錄`);
    return false;
  }

  const originalAccrual = await tx.compLeaveTransaction.findFirst({
    where: {
      employeeId,
      referenceId: overtimeRequestId,
      referenceType: 'OVERTIME',
      transactionType: 'EARN',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!originalAccrual) {
    console.log(`找不到加班申請 ${overtimeRequestId} 對應的補休獲得交易`);
    return false;
  }

  // 計算要扣減的時數
  const hoursToDeduct = hours;
  
  // 更新餘額
  await tx.compLeaveBalance.update({
    where: { employeeId },
    data: originalAccrual.isFrozen
      ? {
          totalUsed: { increment: hoursToDeduct },
          balance: { decrement: hoursToDeduct }
        }
      : {
          pendingUse: { increment: hoursToDeduct }
        }
  });

  await tx.compLeaveTransaction.create({
    data: {
      employeeId,
      transactionType: 'USE',
      hours: hoursToDeduct,
      isFrozen: originalAccrual.isFrozen,
      referenceType: 'OVERTIME_CANCEL',
      referenceId: overtimeRequestId,
      description: `加班撤銷回沖 (加班申請 #${overtimeRequestId})`,
      yearMonth: originalAccrual.yearMonth
    }
  });

  console.log(`已回沖員工 ${employeeId} 的補休 ${hoursToDeduct} 小時`);
  return true;
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

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const overtimeIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!overtimeIdResult.isValid || overtimeIdResult.value === null) {
      return NextResponse.json({ error: '加班申請 ID 格式錯誤' }, { status: 400 });
    }
    const overtimeId = overtimeIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的加班撤銷資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的加班撤銷資料' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫撤銷原因' }, { status: 400 });
    }

    const overtimeRequest = await prisma.overtimeRequest.findUnique({
      where: { id: overtimeId },
      include: {
        employee: {
          select: {
            department: true,
          },
        },
      },
    });

    if (!overtimeRequest) {
      return NextResponse.json({ error: '找不到此加班申請' }, { status: 404 });
    }

    // 檢查是否為本人申請
    if (overtimeRequest.employeeId !== user.employeeId) {
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

    const user = await getUserFromRequest(request);
    if (!user || !['ADMIN', 'HR', 'MANAGER'].includes(user.role)) {
      return NextResponse.json({ error: '需要主管或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const overtimeIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!overtimeIdResult.isValid || overtimeIdResult.value === null) {
      return NextResponse.json({ error: '加班申請 ID 格式錯誤' }, { status: 400 });
    }
    const overtimeId = overtimeIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的加班撤銷資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的加班撤銷資料' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action : undefined;
    const opinion = typeof body.opinion === 'string' ? body.opinion : undefined;
    const note = typeof body.note === 'string' ? body.note : undefined;

    const overtimeRequest = await prisma.overtimeRequest.findUnique({
        where: { id: overtimeId },
        include: {
          employee: {
            select: {
              department: true
            }
          }
        }
    });

    if (!overtimeRequest) {
      return NextResponse.json({ error: '找不到此加班申請' }, { status: 404 });
    }

    if (!overtimeRequest.cancellationStatus) {
      return NextResponse.json({ error: '此申請沒有撤銷請求' }, { status: 400 });
    }

    // 主管/HR 審核（提供意見）
    if ((user.role === 'MANAGER' || user.role === 'HR') && overtimeRequest.cancellationStatus === 'PENDING_MANAGER') {
      if (user.role === 'MANAGER') {
        const managedDepartments = await getManagedDepartments(user.employeeId);
        if (
          managedDepartments.length === 0 ||
          !overtimeRequest.employee?.department ||
          !managedDepartments.includes(overtimeRequest.employee.department)
        ) {
          return NextResponse.json({ error: '無權限審核此部門的加班撤銷申請' }, { status: 403 });
        }
      }

      if (!['AGREE', 'DISAGREE'].includes(opinion ?? '')) {
        return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
      }

      await prisma.overtimeRequest.update({
        where: { id: overtimeId },
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
    if (user.role === 'ADMIN' && 
        (overtimeRequest.cancellationStatus === 'PENDING_ADMIN' || 
         overtimeRequest.cancellationStatus === 'PENDING_MANAGER')) {
      if (!['APPROVE', 'REJECT'].includes(action ?? '')) {
        return NextResponse.json({ error: '請選擇核准或駁回' }, { status: 400 });
      }

      if (action === 'APPROVE') {
        const compLeaveReversed = await prisma.$transaction(async (tx) => {
          const reversed = overtimeRequest.compensationType === 'COMP_LEAVE'
            ? await reverseCompLeave(
                tx,
                overtimeRequest.employeeId,
                overtimeRequest.totalHours,
                overtimeId
              )
            : false;

          await tx.overtimeRequest.update({
            where: { id: overtimeId },
            data: {
              status: 'CANCELLED',
              cancellationStatus: 'APPROVED',
              cancellationAdminApproverId: user.employeeId,
              cancellationAdminNote: note || null,
              cancellationApprovedAt: new Date(),
              compLeaveReversed: reversed,
              compLeaveReversedAt: reversed ? new Date() : null
            }
          });

          return reversed;
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
    console.error('審核加班撤銷申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
