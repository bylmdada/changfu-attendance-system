import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// 獲取忘打卡申請列表
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // 用戶驗證
    const user = getUserFromRequest(request);
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
      whereClause.employeeId = parseInt(employeeId);
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
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const body = await request.json();
    const { workDate, clockType, requestedTime, reason } = body;

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
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以審核
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { id, status, rejectReason } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: '缺少必要字段' },
        { status: 400 }
      );
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json(
        { error: '無效的審核狀態' },
        { status: 400 }
      );
    }

    // 獲取申請信息
    const request_data = await prisma.missedClockRequest.findUnique({
      where: { id: parseInt(id) },
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

    if (request_data.status !== 'PENDING') {
      return NextResponse.json(
        { error: '申請已被處理' },
        { status: 400 }
      );
    }

    // 更新申請狀態
    const updatedRequest = await prisma.missedClockRequest.update({
      where: { id: parseInt(id) },
      data: {
        status,
        approvedBy: user.userId,
        approvedAt: new Date(),
        rejectReason: status === 'REJECTED' ? rejectReason : null
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
      }
    });

    // 如果申請被批准，創建或更新考勤記錄
    if (status === 'APPROVED') {
      const workDate = request_data.workDate;
      const clockType = request_data.clockType;
      const requestedTime = request_data.requestedTime;

      // 查找當天的考勤記錄
      const attendanceRecord = await prisma.attendanceRecord.findFirst({
        where: {
          employeeId: request_data.employeeId,
          workDate: new Date(workDate)
        }
      });

      if (attendanceRecord) {
        // 更新現有記錄
        const updateData: { clockInTime?: string; clockOutTime?: string } = {};
        if (clockType === 'CLOCK_IN') {
          updateData.clockInTime = requestedTime;
        } else if (clockType === 'CLOCK_OUT') {
          updateData.clockOutTime = requestedTime;
        }

        await prisma.attendanceRecord.update({
          where: { id: attendanceRecord.id },
          data: updateData
        });
      } else {
        // 創建新的考勤記錄
        const attendanceData: {
          employeeId: number;
          workDate: Date;
          status: string;
          clockInTime?: string;
          clockOutTime?: string;
        } = {
          employeeId: request_data.employeeId,
          workDate: new Date(workDate),
          status: 'PRESENT'
        };

        if (clockType === 'CLOCK_IN') {
          attendanceData.clockInTime = requestedTime;
        } else if (clockType === 'CLOCK_OUT') {
          attendanceData.clockOutTime = requestedTime;
        }

        await prisma.attendanceRecord.create({
          data: attendanceData
        });
      }
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
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: '缺少申請ID' },
        { status: 400 }
      );
    }

    // 檢查申請是否存在
    const existingRequest = await prisma.missedClockRequest.findUnique({
      where: { id: parseInt(id) }
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
      where: { id: parseInt(id) }
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
