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

// GET - 獲取調班申請列表
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const employeeId = searchParams.get('employeeId');

    const whereClause: {
      status?: string;
      OR?: Array<{ requesterId: number } | { targetEmployeeId: number }>;
      requesterId?: number;
    } = {};

    // 員工只能看自己申請的或被邀請的調班記錄
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      whereClause.OR = [
        { requesterId: user.employeeId },
        { targetEmployeeId: user.employeeId }
      ];
    } else if (employeeId) {
      const employeeIdResult = parseIntegerQueryParam(employeeId, { min: 1, max: 99999999 });
      if (!employeeIdResult.isValid || employeeIdResult.value === null) {
        return NextResponse.json({ error: 'employeeId 格式錯誤' }, { status: 400 });
      }
      whereClause.requesterId = employeeIdResult.value;
    }

    if (status) {
      whereClause.status = status;
    }

    const requests = await prisma.shiftExchangeRequest.findMany({
      where: whereClause,
      include: {
        requester: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        targetEmployee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        approver: {
          select: {
            id: true,
            employeeId: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json({
      success: true,
      requests
    });
  } catch (error) {
    console.error('獲取調班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 新增調班申請
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

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的調班申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的調班申請資料' }, { status: 400 });
    }

    const targetEmployeeIdResult = parseIntegerQueryParam(
      body.targetEmployeeId === undefined || body.targetEmployeeId === null || body.targetEmployeeId === ''
        ? null
        : String(body.targetEmployeeId),
      { min: 1, max: 99999999 }
    );
    if (!targetEmployeeIdResult.isValid || targetEmployeeIdResult.value === null) {
      return NextResponse.json({ error: 'targetEmployeeId 格式錯誤' }, { status: 400 });
    }

    const targetEmployeeId = targetEmployeeIdResult.value;
    const originalWorkDate = typeof body.originalWorkDate === 'string' ? body.originalWorkDate : '';
    const targetWorkDate = typeof body.targetWorkDate === 'string' ? body.targetWorkDate : '';
    const requestReason = typeof body.requestReason === 'string' ? body.requestReason : '';

    // 驗證必填欄位
    if (!targetEmployeeId || !originalWorkDate || !targetWorkDate || !requestReason) {
      return NextResponse.json({ 
        error: '目標員工、原班日期、目標班日期和申請原因為必填' 
      }, { status: 400 });
    }

    // 不能跟自己調班
    if (targetEmployeeId === user.employeeId) {
      return NextResponse.json({ error: '不能與自己調班' }, { status: 400 });
    }

    // 檢查目標員工是否存在
    const targetEmployee = await prisma.employee.findUnique({
      where: { id: targetEmployeeId }
    });

    if (!targetEmployee) {
      return NextResponse.json({ error: '目標員工不存在' }, { status: 404 });
    }

    // 檢查是否已有相同的調班申請（待審核中）
    const existingRequest = await prisma.shiftExchangeRequest.findFirst({
      where: {
        requesterId: user.employeeId,
        targetEmployeeId,
        originalWorkDate,
        targetWorkDate,
        status: 'PENDING'
      }
    });

    if (existingRequest) {
      return NextResponse.json({ error: '已有相同的調班申請待審核' }, { status: 400 });
    }

    // 驗證申請者在原班日期有班表
    const requesterSchedule = await prisma.schedule.findFirst({
      where: {
        employeeId: user.employeeId,
        workDate: originalWorkDate
      }
    });

    if (!requesterSchedule) {
      return NextResponse.json({ error: '您在原班日期沒有排班記錄' }, { status: 400 });
    }

    // 驗證目標員工在目標日期有班表
    const targetSchedule = await prisma.schedule.findFirst({
      where: {
        employeeId: targetEmployeeId,
        workDate: targetWorkDate
      }
    });

    if (!targetSchedule) {
      return NextResponse.json({ error: '目標員工在目標日期沒有排班記錄' }, { status: 400 });
    }

    // 建立調班申請
    const newRequest = await prisma.shiftExchangeRequest.create({
      data: {
        requesterId: user.employeeId,
        targetEmployeeId,
        originalWorkDate,
        targetWorkDate,
        requestReason,
        status: 'PENDING'
      },
      include: {
        requester: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        },
        targetEmployee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: '調班申請已提交',
      request: newRequest
    });
  } catch (error) {
    console.error('新增調班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT - 審核調班申請
export async function PUT(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的調班審核資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的調班審核資料' }, { status: 400 });
    }

    const idResult = parseIntegerQueryParam(
      body.id === undefined || body.id === null || body.id === ''
        ? null
        : String(body.id),
      { min: 1, max: 99999999 }
    );
    if (!idResult.isValid || idResult.value === null) {
      return NextResponse.json({ error: '申請ID 格式錯誤' }, { status: 400 });
    }

    const id = idResult.value;
    const status = typeof body.status === 'string' ? body.status : '';
    const adminRemarks = typeof body.adminRemarks === 'string' ? body.adminRemarks : undefined;

    if (!id || !status) {
      return NextResponse.json({ error: '申請ID和審核狀態為必填' }, { status: 400 });
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: '無效的審核狀態' }, { status: 400 });
    }

    // 查找申請
    const existingRequest = await prisma.shiftExchangeRequest.findUnique({
      where: { id },
      include: {
        requester: true,
        targetEmployee: true
      }
    });

    if (!existingRequest) {
      return NextResponse.json({ error: '調班申請不存在' }, { status: 404 });
    }

    if (existingRequest.status !== 'PENDING') {
      return NextResponse.json({ error: '此申請已被處理' }, { status: 400 });
    }

    let updatedRequest;

    if (status === 'APPROVED') {
      updatedRequest = await prisma.$transaction(async (tx) => {
        const approvedRequest = await tx.shiftExchangeRequest.update({
          where: { id },
          data: {
            status,
            adminRemarks: adminRemarks || null,
            approvedBy: user.employeeId,
            approvedAt: new Date()
          },
          include: {
            requester: {
              select: { id: true, employeeId: true, name: true, department: true }
            },
            targetEmployee: {
              select: { id: true, employeeId: true, name: true, department: true }
            },
            approver: {
              select: { id: true, employeeId: true, name: true }
            }
          }
        });

        const requesterSchedule = await tx.schedule.findFirst({
          where: {
            employeeId: existingRequest.requesterId,
            workDate: existingRequest.originalWorkDate
          }
        });

        const targetSchedule = await tx.schedule.findFirst({
          where: {
            employeeId: existingRequest.targetEmployeeId,
            workDate: existingRequest.targetWorkDate
          }
        });

        if (requesterSchedule && targetSchedule) {
          await tx.schedule.update({
            where: { id: requesterSchedule.id },
            data: {
              shiftType: targetSchedule.shiftType,
              startTime: targetSchedule.startTime,
              endTime: targetSchedule.endTime
            }
          });

          await tx.schedule.update({
            where: { id: targetSchedule.id },
            data: {
              shiftType: requesterSchedule.shiftType,
              startTime: requesterSchedule.startTime,
              endTime: requesterSchedule.endTime
            }
          });
        }

        return approvedRequest;
      });
    } else {
      updatedRequest = await prisma.shiftExchangeRequest.update({
        where: { id },
        data: {
          status,
          adminRemarks: adminRemarks || null,
          approvedBy: user.employeeId,
          approvedAt: new Date()
        },
        include: {
          requester: {
            select: { id: true, employeeId: true, name: true, department: true }
          },
          targetEmployee: {
            select: { id: true, employeeId: true, name: true, department: true }
          },
          approver: {
            select: { id: true, employeeId: true, name: true }
          }
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: status === 'APPROVED' ? '調班申請已批准，班表已交換' : '調班申請已拒絕',
      request: updatedRequest
    });
  } catch (error) {
    console.error('審核調班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE - 取消調班申請
export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的調班取消資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的調班取消資料' }, { status: 400 });
    }

    const idResult = parseIntegerQueryParam(
      body.id === undefined || body.id === null || body.id === ''
        ? null
        : String(body.id),
      { min: 1, max: 99999999 }
    );
    if (!idResult.isValid || idResult.value === null) {
      return NextResponse.json({ error: '申請ID 格式錯誤' }, { status: 400 });
    }

    const id = idResult.value;

    if (!id) {
      return NextResponse.json({ error: '申請ID為必填' }, { status: 400 });
    }

    // 查找申請
    const existingRequest = await prisma.shiftExchangeRequest.findUnique({
      where: { id }
    });

    if (!existingRequest) {
      return NextResponse.json({ error: '調班申請不存在' }, { status: 404 });
    }

    // 只能刪除自己的申請或管理員刪除
    if (existingRequest.requesterId !== user.employeeId && 
        user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限刪除此申請' }, { status: 403 });
    }

    // 只能刪除待審核的申請
    if (existingRequest.status !== 'PENDING') {
      return NextResponse.json({ error: '只能刪除待審核的申請' }, { status: 400 });
    }

    await prisma.shiftExchangeRequest.delete({
      where: { id }
    });

    return NextResponse.json({
      success: true,
      message: '調班申請已取消'
    });
  } catch (error) {
    console.error('刪除調班申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
