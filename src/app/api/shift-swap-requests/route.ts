import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

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
      whereClause.requesterId = parseInt(employeeId);
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

    const body = await request.json();
    const { targetEmployeeId, originalWorkDate, targetWorkDate, requestReason } = body;

    // 驗證必填欄位
    if (!targetEmployeeId || !originalWorkDate || !targetWorkDate || !requestReason) {
      return NextResponse.json({ 
        error: '目標員工、原班日期、目標班日期和申請原因為必填' 
      }, { status: 400 });
    }

    // 不能跟自己調班
    if (parseInt(targetEmployeeId) === user.employeeId) {
      return NextResponse.json({ error: '不能與自己調班' }, { status: 400 });
    }

    // 檢查目標員工是否存在
    const targetEmployee = await prisma.employee.findUnique({
      where: { id: parseInt(targetEmployeeId) }
    });

    if (!targetEmployee) {
      return NextResponse.json({ error: '目標員工不存在' }, { status: 404 });
    }

    // 檢查是否已有相同的調班申請（待審核中）
    const existingRequest = await prisma.shiftExchangeRequest.findFirst({
      where: {
        requesterId: user.employeeId,
        targetEmployeeId: parseInt(targetEmployeeId),
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
        employeeId: parseInt(targetEmployeeId),
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
        targetEmployeeId: parseInt(targetEmployeeId),
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
    const { id, status, adminRemarks } = body;

    if (!id || !status) {
      return NextResponse.json({ error: '申請ID和審核狀態為必填' }, { status: 400 });
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: '無效的審核狀態' }, { status: 400 });
    }

    // 查找申請
    const existingRequest = await prisma.shiftExchangeRequest.findUnique({
      where: { id: parseInt(id) },
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

    // 更新申請狀態
    const updatedRequest = await prisma.shiftExchangeRequest.update({
      where: { id: parseInt(id) },
      data: {
        status,
        adminRemarks: adminRemarks || null,
        approvedBy: decoded.employeeId,
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

    // 如果批准，交換兩人的班表
    if (status === 'APPROVED') {
      // 獲取兩人的班表
      const requesterSchedule = await prisma.schedule.findFirst({
        where: {
          employeeId: existingRequest.requesterId,
          workDate: existingRequest.originalWorkDate
        }
      });

      const targetSchedule = await prisma.schedule.findFirst({
        where: {
          employeeId: existingRequest.targetEmployeeId,
          workDate: existingRequest.targetWorkDate
        }
      });

      if (requesterSchedule && targetSchedule) {
        // 交換班表 - 更新申請者的班表為目標員工的班型
        await prisma.schedule.update({
          where: { id: requesterSchedule.id },
          data: {
            shiftType: targetSchedule.shiftType,
            startTime: targetSchedule.startTime,
            endTime: targetSchedule.endTime
          }
        });

        // 更新目標員工的班表為申請者的班型
        await prisma.schedule.update({
          where: { id: targetSchedule.id },
          data: {
            shiftType: requesterSchedule.shiftType,
            startTime: requesterSchedule.startTime,
            endTime: requesterSchedule.endTime
          }
        });
      }
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

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: '申請ID為必填' }, { status: 400 });
    }

    // 查找申請
    const existingRequest = await prisma.shiftExchangeRequest.findUnique({
      where: { id: parseInt(id) }
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
      where: { id: parseInt(id) }
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
