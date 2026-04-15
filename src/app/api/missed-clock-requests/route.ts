import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinalReviewer(role: string) {
  return role === 'ADMIN' || role === 'HR';
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

// 獲取忘打卡申請列表
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // 用戶驗證
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employeeId');
    const status = searchParams.get('status');

    const whereClause: {
      employeeId?: number;
      status?: string;
    } = {};

    // 非管理員只能查看自己的申請
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      whereClause.employeeId = user.employeeId;
    } else if (employeeId) {
      const parsedEmployeeId = parseIntegerQueryParam(employeeId, { min: 1 });
      if (!parsedEmployeeId.isValid || parsedEmployeeId.value === null) {
        return NextResponse.json(
          { error: 'employeeId 格式錯誤' },
          { status: 400 }
        );
      }

      whereClause.employeeId = parsedEmployeeId.value;
    }

    if (status) {
      whereClause.status = status;
    }

    const requests = await prisma.missedClockRequest.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        approvedByUser: {
          select: {
            id: true,
            username: true,
            employee: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error('獲取忘打卡申請失敗:', error);
    return NextResponse.json(
      { error: '獲取申請列表失敗' },
      { status: 500 }
    );
  }
}

// 創建新的忘打卡申請
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    // 用戶驗證
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的忘打卡申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { error: '請提供有效的忘打卡申請資料' },
        { status: 400 }
      );
    }

    const { workDate, clockType, requestedTime, reason } = body as {
      workDate?: string;
      clockType?: string;
      requestedTime?: string;
      reason?: string;
    };

    // 使用當前用戶的 employeeId
    const employeeId = user.employeeId;

    // 驗證必要字段
    if (!workDate || !clockType || !requestedTime || !reason) {
      return NextResponse.json(
        { error: '缺少必要字段' },
        { status: 400 }
      );
    }

    // 驗證打卡類型
    if (!['CLOCK_IN', 'CLOCK_OUT'].includes(clockType)) {
      return NextResponse.json(
        { error: '無效的打卡類型' },
        { status: 400 }
      );
    }

    // 檢查是否已有相同日期和類型的申請
    const existingRequest = await prisma.missedClockRequest.findFirst({
      where: {
        employeeId,
        workDate: workDate,
        clockType: clockType,
        status: {
          in: ['PENDING', 'APPROVED']
        }
      }
    });

    if (existingRequest) {
      return NextResponse.json(
        { error: '該日期和打卡類型已有申請記錄' },
        { status: 400 }
      );
    }

    // 檢查凍結狀態
    const workDateObj = new Date(workDate);
    const freezeCheck = await checkAttendanceFreeze(workDateObj);
    if (freezeCheck.isFrozen) {
      const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW');
      return NextResponse.json({
        error: `該月份已被凍結，無法提交忘打卡申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
      }, { status: 403 });
    }

    // 創建新申請
    const newRequest = await prisma.missedClockRequest.create({
      data: {
        employeeId,
        workDate,
        clockType,
        requestedTime,
        reason,
        status: 'PENDING'
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      }
    });

    // 建立審核實例
    await createApprovalForRequest({
      requestType: 'MISSED_CLOCK',
      requestId: newRequest.id,
      applicantId: newRequest.employee.id,
      applicantName: newRequest.employee.name,
      department: newRequest.employee.department
    });

    return NextResponse.json({ 
      message: '申請提交成功',
      request: newRequest 
    });
  } catch (error) {
    console.error('創建忘打卡申請失敗:', error);
    return NextResponse.json(
      { error: '申請提交失敗' },
      { status: 500 }
    );
  }
}

// 審核忘打卡申請
export async function PUT(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    // 用戶驗證
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!['ADMIN', 'HR', 'MANAGER'].includes(user.role)) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的忘打卡申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { error: '請提供有效的忘打卡申請資料' },
        { status: 400 }
      );
    }

    const { id, status } = body as {
      id?: number | string;
      status?: string;
    };
    const opinion = typeof body.opinion === 'string' ? body.opinion : undefined;
    const remarks =
      typeof body.remarks === 'string'
        ? body.remarks
        : typeof body.reason === 'string'
          ? body.reason
          : undefined;
    const rejectReason =
      typeof body.rejectReason === 'string'
        ? body.rejectReason
        : remarks;

    if (!id) {
      return NextResponse.json(
        { error: '缺少必要字段' },
        { status: 400 }
      );
    }

    const parsedRequestId = parseIntegerQueryParam(String(id), { min: 1 });
    if (!parsedRequestId.isValid || parsedRequestId.value === null) {
      return NextResponse.json(
        { error: '申請ID格式錯誤' },
        { status: 400 }
      );
    }

    const requestId = parsedRequestId.value;

    // 獲取申請信息
    const request_data = await prisma.missedClockRequest.findUnique({
      where: { id: requestId },
      include: {
        employee: true
      }
    });

    if (!request_data) {
      return NextResponse.json(
        { error: '申請不存在' },
        { status: 404 }
      );
    }

    const includeApprovalContext = {
      employee: {
        select: {
          id: true,
          employeeId: true,
          name: true,
          department: true,
          position: true
        }
      },
      approvedByUser: {
        select: {
          id: true,
          username: true,
          employee: {
            select: {
              name: true
            }
          }
        }
      }
    };

    if (user.role === 'MANAGER') {
      if (!opinion || !['AGREE', 'DISAGREE'].includes(opinion)) {
        return NextResponse.json(
          { error: '請選擇同意或不同意' },
          { status: 400 }
        );
      }

      if (request_data.status !== 'PENDING') {
        return NextResponse.json(
          { error: '申請已被處理' },
          { status: 400 }
        );
      }

      const managedDepartments = await getManagedDepartments(user.employeeId);
      if (
        managedDepartments.length === 0 ||
        !request_data.employee?.department ||
        !managedDepartments.includes(request_data.employee.department)
      ) {
        return NextResponse.json(
          { error: '無權限審核其他部門的忘打卡申請' },
          { status: 403 }
        );
      }

      const reviewedRequest = await prisma.missedClockRequest.update({
        where: { id: requestId },
        data: {
          status: 'PENDING_ADMIN',
          managerReviewerId: user.employeeId,
          managerOpinion: opinion,
          managerNote: remarks || null,
          managerReviewedAt: new Date(),
        },
        include: includeApprovalContext,
      });

      return NextResponse.json({
        message: '主管已審核，已轉交管理員決核',
        request: reviewedRequest,
      });
    }

    if (!isFinalReviewer(user.role)) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json(
        { error: '無效的審核狀態' },
        { status: 400 }
      );
    }

    if (request_data.status !== 'PENDING' && request_data.status !== 'PENDING_ADMIN') {
      return NextResponse.json(
        { error: '申請已被處理' },
        { status: 400 }
      );
    }

    const approvedAt = new Date();

    const updateRequestData = {
      status,
      approvedBy: user.employeeId,
      approvedAt,
      rejectReason: status === 'REJECTED' ? rejectReason || null : null
    };

    let updatedRequest;

    if (status === 'APPROVED') {
      updatedRequest = await prisma.$transaction(async (tx) => {
        const requestUpdate = await tx.missedClockRequest.update({
          where: { id: requestId },
          data: updateRequestData,
          include: includeApprovalContext,
        });

        const attendanceRecord = await tx.attendanceRecord.findFirst({
          where: {
            employeeId: request_data.employeeId,
            workDate: new Date(request_data.workDate)
          }
        });

        if (attendanceRecord) {
          const updateData: { clockInTime?: string; clockOutTime?: string } = {};
          if (request_data.clockType === 'CLOCK_IN') {
            updateData.clockInTime = request_data.requestedTime;
          } else if (request_data.clockType === 'CLOCK_OUT') {
            updateData.clockOutTime = request_data.requestedTime;
          }

          await tx.attendanceRecord.update({
            where: { id: attendanceRecord.id },
            data: updateData
          });
        } else {
          const attendanceData: {
            employeeId: number;
            workDate: Date;
            status: string;
            clockInTime?: string;
            clockOutTime?: string;
          } = {
            employeeId: request_data.employeeId,
            workDate: new Date(request_data.workDate),
            status: 'PRESENT'
          };

          if (request_data.clockType === 'CLOCK_IN') {
            attendanceData.clockInTime = request_data.requestedTime;
          } else if (request_data.clockType === 'CLOCK_OUT') {
            attendanceData.clockOutTime = request_data.requestedTime;
          }

          await tx.attendanceRecord.create({
            data: attendanceData
          });
        }

        return requestUpdate;
      });
    } else {
      updatedRequest = await prisma.missedClockRequest.update({
        where: { id: requestId },
        data: updateRequestData,
        include: includeApprovalContext,
      });
    }

    return NextResponse.json({ 
      message: status === 'APPROVED' ? '申請已批准' : '申請已拒絕',
      request: updatedRequest 
    });
  } catch (error) {
    console.error('審核忘打卡申請失敗:', error);
    return NextResponse.json(
      { error: '審核處理失敗' },
      { status: 500 }
    );
  }
}

// 刪除忘打卡申請
export async function DELETE(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // 用戶驗證
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的忘打卡申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { error: '請提供有效的忘打卡申請資料' },
        { status: 400 }
      );
    }

    const { id } = body as { id?: number | string };

    if (!id) {
      return NextResponse.json(
        { error: '缺少申請ID' },
        { status: 400 }
      );
    }

    const parsedRequestId = parseIntegerQueryParam(String(id), { min: 1 });
    if (!parsedRequestId.isValid || parsedRequestId.value === null) {
      return NextResponse.json(
        { error: '申請ID格式錯誤' },
        { status: 400 }
      );
    }

    // 檢查申請是否存在
    const existingRequest = await prisma.missedClockRequest.findUnique({
      where: { id: parsedRequestId.value }
    });

    if (!existingRequest) {
      return NextResponse.json(
        { error: '申請不存在' },
        { status: 404 }
      );
    }

    // 只允許刪除自己的申請或管理員刪除
    if (existingRequest.employeeId !== user.employeeId && 
        user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json(
        { error: '無權限刪除此申請' },
        { status: 403 }
      );
    }

    // 只允許刪除待審核的申請
    if (existingRequest.status !== 'PENDING') {
      return NextResponse.json(
        { error: '只能刪除待審核的申請' },
        { status: 400 }
      );
    }

    await prisma.missedClockRequest.delete({
      where: { id: parsedRequestId.value }
    });

    return NextResponse.json({ message: '申請已刪除' });
  } catch (error) {
    console.error('刪除忘打卡申請失敗:', error);
    return NextResponse.json(
      { error: '刪除申請失敗' },
      { status: 500 }
    );
  }
}
