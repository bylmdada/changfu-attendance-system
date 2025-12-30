'use server';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { cookies } from 'next/headers';
import { createApprovalForRequest } from '@/lib/approval-helper';

// 生成請購單號
async function generateRequestNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `PR-${year}${month}`;
  
  // 查詢當月最大序號
  const lastRequest = await prisma.purchaseRequest.findFirst({
    where: {
      requestNumber: {
        startsWith: prefix
      }
    },
    orderBy: {
      requestNumber: 'desc'
    }
  });

  let sequence = 1;
  if (lastRequest) {
    const lastNumber = parseInt(lastRequest.requestNumber.slice(-3));
    sequence = lastNumber + 1;
  }

  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

// GET - 取得請購單列表
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的 token' }, { status: 401 });
    }

    // 取得用戶資料
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true }
    });

    if (!user) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    const isAdmin = user.role === 'ADMIN' || user.role === 'HR';
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const department = searchParams.get('department');

    // 建立查詢條件
    const where: Record<string, unknown> = {};

    // 非管理員只能看自己的申請
    if (!isAdmin) {
      where.employeeId = user.employee.id;
    }

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (department && isAdmin) {
      where.department = department;
    }

    const purchaseRequests = await prisma.purchaseRequest.findMany({
      where,
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
        approver: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json({ purchaseRequests });
  } catch (error) {
    console.error('取得請購單列表失敗:', error);
    return NextResponse.json({ error: '取得請購單列表失敗' }, { status: 500 });
  }
}

// POST - 新增請購單
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的 token' }, { status: 401 });
    }

    // 取得用戶資料
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true }
    });

    if (!user) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    const body = await request.json();
    const { title, category, items, totalAmount, reason, priority } = body;

    if (!title || !items || !reason) {
      return NextResponse.json({ error: '請填寫必要欄位' }, { status: 400 });
    }

    // 驗證類別
    const validCategories = ['MEDICAL', 'CARE_SUPPLIES', 'OFFICE', 'IT_EQUIPMENT', 'FURNITURE', 'CLEANING', 'FOOD', 'KITCHEN', 'MAINTENANCE', 'UNIFORM', 'ACTIVITY', 'OTHER'];
    const validCategory = validCategories.includes(category) ? category : 'OTHER';

    // 生成單號
    const requestNumber = await generateRequestNumber();

    const purchaseRequest = await prisma.purchaseRequest.create({
      data: {
        requestNumber,
        employeeId: user.employee.id,
        department: user.employee.department || '',
        title,
        category: validCategory,
        items: typeof items === 'string' ? items : JSON.stringify(items),
        totalAmount: totalAmount || 0,
        reason,
        priority: priority || 'NORMAL',
        status: 'PENDING'
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        }
      }
    });

    // 建立審核實例
    await createApprovalForRequest({
      requestType: 'PURCHASE',
      requestId: purchaseRequest.id,
      applicantId: purchaseRequest.employee.id,
      applicantName: purchaseRequest.employee.name,
      department: purchaseRequest.employee.department
    });

    return NextResponse.json({ 
      message: '請購單已提交',
      purchaseRequest 
    }, { status: 201 });
  } catch (error) {
    console.error('新增請購單失敗:', error);
    return NextResponse.json({ error: '新增請購單失敗' }, { status: 500 });
  }
}

// PUT - 審核請購單
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的 token' }, { status: 401 });
    }

    // 取得用戶資料
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true }
    });

    if (!user) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    // 只有管理員可以審核
    const isAdmin = user.role === 'ADMIN' || user.role === 'HR';
    if (!isAdmin) {
      return NextResponse.json({ error: '無權限審核' }, { status: 403 });
    }

    const body = await request.json();
    const { id, status, rejectReason } = body;

    if (!id || !status) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: '無效的狀態' }, { status: 400 });
    }

    // 檢查請購單是否存在
    const existingRequest = await prisma.purchaseRequest.findUnique({
      where: { id }
    });

    if (!existingRequest) {
      return NextResponse.json({ error: '請購單不存在' }, { status: 404 });
    }

    if (existingRequest.status !== 'PENDING') {
      return NextResponse.json({ error: '此請購單已處理' }, { status: 400 });
    }

    const purchaseRequest = await prisma.purchaseRequest.update({
      where: { id },
      data: {
        status,
        approvedBy: user.employee.id,
        approvedAt: new Date(),
        rejectReason: status === 'REJECTED' ? rejectReason : null
      },
      include: {
        employee: {
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
      message: status === 'APPROVED' ? '已核准' : '已駁回',
      purchaseRequest 
    });
  } catch (error) {
    console.error('審核請購單失敗:', error);
    return NextResponse.json({ error: '審核請購單失敗' }, { status: 500 });
  }
}

// DELETE - 刪除請購單（僅申請人可刪除待審核的單）
export async function DELETE(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的 token' }, { status: 401 });
    }

    // 取得用戶資料
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true }
    });

    if (!user) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '');

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    // 檢查請購單是否存在
    const existingRequest = await prisma.purchaseRequest.findUnique({
      where: { id }
    });

    if (!existingRequest) {
      return NextResponse.json({ error: '請購單不存在' }, { status: 404 });
    }

    // 只有申請人可以刪除自己的待審核單
    const isAdmin = user.role === 'ADMIN' || user.role === 'HR';
    const isOwner = existingRequest.employeeId === user.employee.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: '無權限刪除' }, { status: 403 });
    }

    if (!isAdmin && existingRequest.status !== 'PENDING') {
      return NextResponse.json({ error: '只能刪除待審核的申請' }, { status: 400 });
    }

    await prisma.purchaseRequest.delete({
      where: { id }
    });

    return NextResponse.json({ message: '已刪除' });
  } catch (error) {
    console.error('刪除請購單失敗:', error);
    return NextResponse.json({ error: '刪除請購單失敗' }, { status: 500 });
  }
}
