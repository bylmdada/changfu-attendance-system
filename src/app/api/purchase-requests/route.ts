'use server';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { validateCSRF } from '@/lib/csrf';
import { getTaiwanNow } from '@/lib/timezone';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 生成請購單號
async function generateRequestNumber(): Promise<string> {
  const now = getTaiwanNow();
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
    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
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
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: csrfValidation.error }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 取得用戶資料
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true }
    });

    if (!user) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的請購資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的請購資料' }, { status: 400 });
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const category = typeof body.category === 'string' ? body.category : '';
    const items = body.items;
    const totalAmount = typeof body.totalAmount === 'number'
      ? body.totalAmount
      : typeof body.totalAmount === 'string' && body.totalAmount.trim()
        ? Number(body.totalAmount)
        : 0;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const priority = typeof body.priority === 'string' ? body.priority : 'NORMAL';

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
        totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
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
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: csrfValidation.error }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
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

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的請購審核資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的請購審核資料' }, { status: 400 });
    }

    const rawId = body.id;
    const id = typeof rawId === 'number'
      ? rawId
      : typeof rawId === 'string' && rawId.trim()
        ? Number(rawId)
        : NaN;
    const status = body.status === 'APPROVED' || body.status === 'REJECTED' ? body.status : '';
    const rejectReason = typeof body.rejectReason === 'string' ? body.rejectReason : null;

    if (!Number.isInteger(id) || id <= 0 || !status) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
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

    // 同步更新審核實例和審核記錄
    const approvalInstance = await prisma.approvalInstance.findFirst({
      where: {
        requestType: 'PURCHASE',
        requestId: id
      }
    });

    if (approvalInstance) {
      // 建立審核記錄
      await prisma.approvalReview.create({
        data: {
          instanceId: approvalInstance.id,
          level: approvalInstance.currentLevel,
          reviewerId: user.employee.id,
          reviewerName: user.employee.name,
          reviewerRole: user.role === 'ADMIN' ? '管理員' : user.role === 'HR' ? '人資' : '審核者',
          action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
          comment: rejectReason || null
        }
      });

      // 更新實例狀態
      await prisma.approvalInstance.update({
        where: { id: approvalInstance.id },
        data: {
          status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
          currentLevel: approvalInstance.maxLevel
        }
      });
    }

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
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: csrfValidation.error }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
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
