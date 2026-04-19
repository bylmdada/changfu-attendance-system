import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { Prisma } from '@prisma/client';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const APPROVAL_DELEGATE_RESOURCE_TYPES = ['LEAVE', 'OVERTIME', 'SHIFT'] as const;
type ApprovalDelegateResourceType = typeof APPROVAL_DELEGATE_RESOURCE_TYPES[number];
const APPROVAL_DELEGATE_RESOURCE_TYPE_SET = new Set<ApprovalDelegateResourceType>(APPROVAL_DELEGATE_RESOURCE_TYPES);

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBodyPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    return parsePositiveInteger(value);
  }

  return null;
}

function parseDateInput(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRequestResourceTypes(value: unknown): { resourceTypes: ApprovalDelegateResourceType[] | null; error: string | null } {
  if (value === null || value === undefined) {
    return { resourceTypes: null, error: null };
  }

  if (!Array.isArray(value)) {
    return { resourceTypes: null, error: 'resourceTypes 必須是陣列或 null' };
  }

  const normalized = Array.from(new Set(value));
  const invalidType = normalized.find((item) => (
    typeof item !== 'string' || !APPROVAL_DELEGATE_RESOURCE_TYPE_SET.has(item as ApprovalDelegateResourceType)
  ));

  if (invalidType) {
    return { resourceTypes: null, error: 'resourceTypes 包含不支援的審核類型' };
  }

  return {
    resourceTypes: normalized.length === 0 ? null : normalized as ApprovalDelegateResourceType[],
    error: null
  };
}

function parseStoredResourceTypes(value: string | null): ApprovalDelegateResourceType[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((item): item is ApprovalDelegateResourceType => (
      typeof item === 'string' && APPROVAL_DELEGATE_RESOURCE_TYPE_SET.has(item as ApprovalDelegateResourceType)
    ));
  } catch {
    return null;
  }
}

function isPrivilegedRole(role: string | undefined) {
  return role === 'ADMIN' || role === 'HR';
}

// GET - 取得代理審核設定
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/approval-delegates');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const decoded = await getUserFromRequest(request);

    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const delegatorId = searchParams.get('delegatorId');
    const delegateId = searchParams.get('delegateId');
    const onlyActive = searchParams.get('active') !== 'false';
    const normalizedDelegatorId = delegatorId ? parsePositiveInteger(delegatorId) : null;
    const normalizedDelegateId = delegateId ? parsePositiveInteger(delegateId) : null;

    if (delegatorId && normalizedDelegatorId === null) {
      return NextResponse.json({ error: 'delegatorId 格式錯誤' }, { status: 400 });
    }

    if (delegateId && normalizedDelegateId === null) {
      return NextResponse.json({ error: 'delegateId 格式錯誤' }, { status: 400 });
    }

    const now = new Date();
    const whereConditions: Prisma.ApprovalDelegateWhereInput[] = [];

    if (!isPrivilegedRole(decoded.role)) {
      if (!decoded.employeeId) {
        return NextResponse.json({ error: '缺少員工資訊' }, { status: 403 });
      }

      whereConditions.push({
        OR: [
          { delegatorId: decoded.employeeId },
          { delegateId: decoded.employeeId }
        ]
      });
    }

    if (normalizedDelegatorId !== null) {
      whereConditions.push({ delegatorId: normalizedDelegatorId });
    }

    if (normalizedDelegateId !== null) {
      whereConditions.push({ delegateId: normalizedDelegateId });
    }

    if (onlyActive) {
      whereConditions.push({
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now }
      });
    }

    const whereClause = whereConditions.length === 0
      ? undefined
      : whereConditions.length === 1
        ? whereConditions[0]
        : { AND: whereConditions };

    const delegates = await prisma.approvalDelegate.findMany({
      where: whereClause,
      include: {
        delegator: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        delegate: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      },
      orderBy: { startDate: 'desc' }
    });

    // 解析 JSON 欄位
    const parsedDelegates = delegates.map(d => ({
      ...d,
      resourceTypes: parseStoredResourceTypes(d.resourceTypes)
    }));

    return NextResponse.json({
      success: true,
      delegates: parsedDelegates
    });
  } catch (error) {
    console.error('取得代理審核設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 建立代理審核設定
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/approval-delegates');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);

    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的代理審核設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的代理審核設定資料' }, { status: 400 });
    }

    const normalizedDelegatorId = parseBodyPositiveInteger(body.delegatorId);
    const normalizedDelegateId = parseBodyPositiveInteger(body.delegateId);
    const start = parseDateInput(body.startDate);
    const end = parseDateInput(body.endDate);
    const { resourceTypes, error: resourceTypesError } = parseRequestResourceTypes(body.resourceTypes);

    // 驗證
    if (!normalizedDelegatorId || !normalizedDelegateId || !start || !end) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    if (resourceTypesError) {
      return NextResponse.json({ error: resourceTypesError }, { status: 400 });
    }

    if (normalizedDelegatorId === normalizedDelegateId) {
      return NextResponse.json({ error: '委託人與代理人不能相同' }, { status: 400 });
    }

    if (end <= start) {
      return NextResponse.json({ error: '結束日期必須晚於開始日期' }, { status: 400 });
    }

    // 權限檢查：只能設定自己的代理，或 HR/管理員可設定任何人
    if (!isPrivilegedRole(decoded.role) && decoded.employeeId !== normalizedDelegatorId) {
      return NextResponse.json({ error: '只能設定自己的代理審核' }, { status: 403 });
    }

    const [delegator, delegateEmployee, managerRecord] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: normalizedDelegatorId },
        select: { id: true }
      }),
      prisma.employee.findUnique({
        where: { id: normalizedDelegateId },
        select: { id: true }
      }),
      prisma.departmentManager.findFirst({
        where: {
          employeeId: normalizedDelegatorId,
          isActive: true
        },
        select: { id: true }
      })
    ]);

    if (!delegator || !delegateEmployee) {
      return NextResponse.json({ error: '找不到委託人或代理人資料' }, { status: 404 });
    }

    if (!managerRecord) {
      return NextResponse.json({ error: '委託人目前不是有效主管，無法設定代理審核' }, { status: 400 });
    }

    // 檢查是否有重疊的代理設定
    const overlapping = await prisma.approvalDelegate.findFirst({
      where: {
        delegatorId: normalizedDelegatorId,
        isActive: true,
        OR: [
          { startDate: { lte: end }, endDate: { gte: start } }
        ]
      }
    });

    if (overlapping) {
      return NextResponse.json({ 
        error: '該時段已有代理設定，請先取消現有設定',
        existingDelegate: overlapping
      }, { status: 400 });
    }

    const delegate = await prisma.approvalDelegate.create({
      data: {
        delegatorId: normalizedDelegatorId,
        delegateId: normalizedDelegateId,
        startDate: start,
        endDate: end,
        resourceTypes: resourceTypes ? JSON.stringify(resourceTypes) : null,
        isActive: true
      },
      include: {
        delegator: {
          select: { id: true, name: true }
        },
        delegate: {
          select: { id: true, name: true }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: '代理審核設定已建立',
      delegate: {
        ...delegate,
        resourceTypes: parseStoredResourceTypes(delegate.resourceTypes)
      }
    });
  } catch (error) {
    console.error('建立代理審核設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE - 取消代理審核設定
export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/approval-delegates');
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);

    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    const normalizedId = parsePositiveInteger(id);
    if (!normalizedId) {
      return NextResponse.json({ error: 'ID 格式錯誤' }, { status: 400 });
    }

    const existing = await prisma.approvalDelegate.findUnique({
      where: { id: normalizedId }
    });

    if (!existing) {
      return NextResponse.json({ error: '找不到該代理設定' }, { status: 404 });
    }

    // 權限檢查
    if (!isPrivilegedRole(decoded.role) && decoded.employeeId !== existing.delegatorId) {
      return NextResponse.json({ error: '無權取消此代理設定' }, { status: 403 });
    }

    await prisma.approvalDelegate.update({
      where: { id: normalizedId },
      data: { isActive: false }
    });

    return NextResponse.json({
      success: true,
      message: '代理審核設定已取消'
    });
  } catch (error) {
    console.error('取消代理審核設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
