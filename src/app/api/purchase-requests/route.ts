'use server';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { getTaiwanNow } from '@/lib/timezone';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VALID_CATEGORIES = ['MEDICAL', 'CARE_SUPPLIES', 'OFFICE', 'IT_EQUIPMENT', 'FURNITURE', 'CLEANING', 'FOOD', 'KITCHEN', 'MAINTENANCE', 'UNIFORM', 'ACTIVITY', 'OTHER'];
const VALID_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

interface PurchaseItem {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  note: string;
}

function parsePurchaseNumber(value: unknown) {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parsePurchaseItems(rawItems: unknown): PurchaseItem[] | null {
  const parsedItems = typeof rawItems === 'string'
    ? (() => {
        try {
          return JSON.parse(rawItems);
        } catch {
          return null;
        }
      })()
    : rawItems;

  if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
    return null;
  }

  const normalizedItems: PurchaseItem[] = [];

  for (const item of parsedItems) {
    if (!isPlainObject(item)) {
      return null;
    }

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const quantity = parsePurchaseNumber(item.quantity);
    const price = parsePurchaseNumber(item.price);
    const unit = typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim() : '個';
    const note = typeof item.note === 'string' ? item.note.trim() : '';

    if (!name || quantity === null || price === null || quantity <= 0 || price < 0) {
      return null;
    }

    normalizedItems.push({
      name,
      quantity,
      unit,
      price,
      note
    });
  }

  return normalizedItems;
}

function isDuplicatePurchaseRequestError(error: unknown) {
  if (!isPlainObject(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';

  return code === 'P2002' || message.includes('UNIQUE constraint failed');
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
      if (!user.employee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
      }
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

    if (!user.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
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
    const items = parsePurchaseItems(body.items);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const priority = typeof body.priority === 'string' && VALID_PRIORITIES.includes(body.priority as (typeof VALID_PRIORITIES)[number])
      ? body.priority
      : 'NORMAL';

    if (!title || !reason) {
      return NextResponse.json({ error: '請填寫必要欄位' }, { status: 400 });
    }

    if (!items) {
      return NextResponse.json({ error: '請至少填寫一項有效的採購項目' }, { status: 400 });
    }

    const totalAmount = Number(items.reduce((sum, item) => sum + (item.quantity * item.price), 0).toFixed(2));
    if (totalAmount <= 0) {
      return NextResponse.json({ error: '請購金額必須大於 0' }, { status: 400 });
    }

    const validCategory = VALID_CATEGORIES.includes(category) ? category : 'OTHER';

    let purchaseRequest: Awaited<ReturnType<typeof prisma.purchaseRequest.create>> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const requestNumber = await generateRequestNumber();

      try {
        purchaseRequest = await prisma.purchaseRequest.create({
          data: {
            requestNumber,
            employeeId: user.employee.id,
            department: user.employee.department || '',
            title,
            category: validCategory,
            items: JSON.stringify(items),
            totalAmount,
            reason,
            priority,
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
        break;
      } catch (error) {
        if (!isDuplicatePurchaseRequestError(error) || attempt === 2) {
          throw error;
        }
      }
    }

    if (!purchaseRequest) {
      return NextResponse.json({ error: '請購單號產生衝突，請稍後重試' }, { status: 409 });
    }

    // 建立審核實例
    const approvalResult = await createApprovalForRequest({
      requestType: 'PURCHASE',
      requestId: purchaseRequest.id,
      applicantId: user.employee.id,
      applicantName: user.employee.name,
      department: user.employee.department
    });

    if (!approvalResult.success) {
      await prisma.purchaseRequest.delete({
        where: { id: purchaseRequest.id }
      });

      console.error('建立請購審核實例失敗:', approvalResult.error);
      return NextResponse.json({ error: '建立請購審核流程失敗' }, { status: 500 });
    }

    return NextResponse.json({ 
      message: '請購單已提交',
      purchaseRequest 
    }, { status: 201 });
  } catch (error) {
    if (isDuplicatePurchaseRequestError(error)) {
      return NextResponse.json({ error: '請購單號產生衝突，請稍後重試' }, { status: 409 });
    }

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

    if (!user.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
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
    const idResult = parseIntegerQueryParam(
      typeof rawId === 'number'
        ? String(rawId)
        : typeof rawId === 'string'
          ? rawId.trim()
          : null,
      { min: 1 }
    );
    const status = body.status === 'APPROVED' || body.status === 'REJECTED' ? body.status : '';
    const rejectReason = typeof body.rejectReason === 'string' ? body.rejectReason.trim() : '';

    if (!idResult.isValid || idResult.value === null || !status) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }
    const id = idResult.value;

    if (status === 'REJECTED' && !rejectReason) {
      return NextResponse.json({ error: '請填寫駁回原因' }, { status: 400 });
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

    const approvalInstance = await prisma.approvalInstance.findFirst({
      where: {
        requestType: 'PURCHASE',
        requestId: id
      }
    });

    if (!approvalInstance) {
      return NextResponse.json({ error: '此請購單缺少審核流程，請聯絡管理員' }, { status: 409 });
    }

    const approvedAt = new Date();
    const [purchaseRequest] = await prisma.$transaction([
      prisma.purchaseRequest.update({
        where: { id },
        data: {
          status,
          approvedBy: user.employee.id,
          approvedAt,
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
      }),
      prisma.approvalReview.create({
        data: {
          instanceId: approvalInstance.id,
          level: approvalInstance.currentLevel,
          reviewerId: user.employee.id,
          reviewerName: user.employee.name,
          reviewerRole: user.role === 'ADMIN' ? '管理員' : user.role === 'HR' ? '人資' : '審核者',
          action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
          comment: status === 'REJECTED' ? rejectReason : null
        }
      }),
      prisma.approvalInstance.update({
        where: { id: approvalInstance.id },
        data: {
          status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
          currentLevel: approvalInstance.maxLevel
        }
      })
    ]);

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

    if (!user.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const idResult = parseIntegerQueryParam(searchParams.get('id'), { min: 1 });

    if (!idResult.isValid || idResult.value === null) {
      return NextResponse.json({ error: '請購單 ID 格式無效' }, { status: 400 });
    }
    const id = idResult.value;

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

    if (existingRequest.status !== 'PENDING') {
      return NextResponse.json({ error: '只能刪除待審核的申請' }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.approvalInstance.deleteMany({
        where: {
          requestType: 'PURCHASE',
          requestId: id
        }
      }),
      prisma.purchaseRequest.delete({
        where: { id }
      })
    ]);

    return NextResponse.json({ message: '已刪除' });
  } catch (error) {
    console.error('刪除請購單失敗:', error);
    return NextResponse.json({ error: '刪除請購單失敗' }, { status: 500 });
  }
}
