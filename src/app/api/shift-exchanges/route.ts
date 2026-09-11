import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { getAttendancePermissionDepartments } from '@/lib/attendance-permission-scopes';
import { findActiveShiftDefinition } from '@/lib/shift-definition-service';
import { buildApplicationRequestNumber } from '@/lib/application-request-number';

interface DBItem {
  id: number;
  requesterId: number;
  targetEmployeeId: number;
  originalWorkDate: string;
  targetWorkDate: string;
  requestReason: string;
  originalShiftType?: string | null;
  newShiftType?: string | null;
  leaveType?: string | null;
  status: string;
  createdAt: Date;
  requester?: {
    id: number;
    employeeId: string;
    name: string;
    department: string | null;
    position: string | null;
  };
  targetEmployee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string | null;
    position: string | null;
  } | null;
  approver?: {
    id: number;
    employeeId: string;
    name: string;
    position: string | null;
  } | null;
  shiftDate?: string;
  reason?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// normalize a DB item to the frontend shape
function normalizeItem(it: DBItem) {
  const item = {
    ...it,
    requestNumber: buildApplicationRequestNumber('SE', it.id, it.createdAt),
  };

  // requester/targetEmployee placeholders
  item.requester = item.requester || { 
    id: item.requesterId, 
    employeeId: String(item.requesterId), 
    name: '已刪除', 
    department: null, 
    position: null 
  };
  item.targetEmployee = item.targetEmployee || null;
  item.approver = item.approver || null;

  // derive frontend-friendly fields
  // If requestReason is structured SELF_CHANGE, extract shift types and shiftDate
  if (item.originalShiftType && item.newShiftType) {
    item.shiftDate = item.originalWorkDate;
    item.reason = item.requestReason;
    item.leaveType ||= '';
    return item;
  }

  try {
    const parsed = JSON.parse(item.requestReason) as {
      type?: string;
      shiftDate?: string;
      original?: string;
      new?: string;
      note?: string;
      reason?: string;
      leaveType?: string;
    };
    if (parsed.type !== 'SELF_CHANGE' || !parsed.original || !parsed.new) return null;
    item.shiftDate = parsed.shiftDate ?? item.originalWorkDate;
    item.originalShiftType = parsed.original;
    item.newShiftType = parsed.new;
    item.leaveType = parsed.leaveType ?? '';
    item.reason = parsed.note ?? parsed.reason ?? '';
    return item;
  } catch {
    return null;
  }
}

// 查詢調班記錄列表
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const requesterIdParam = searchParams.get('requesterId');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};
    if (status) where.status = status;

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      const manageableDepartments = await getAttendancePermissionDepartments({
        role: user.role,
        employeeId: user.employeeId,
      }, 'shiftExchanges');

      if (manageableDepartments.length > 0) {
        where.requester = {
          department: { in: manageableDepartments }
        };

        if (requesterIdParam) {
          const requesterIdResult = parseIntegerQueryParam(requesterIdParam, { min: 1, max: 99999999 });
          if (!requesterIdResult.isValid || requesterIdResult.value === null) {
            return NextResponse.json({ error: 'requesterId 格式錯誤' }, { status: 400 });
          }
          where.requesterId = requesterIdResult.value;
        }
      } else {
        where.requesterId = user.employeeId;
      }
    } else if (requesterIdParam) {
      const requesterIdResult = parseIntegerQueryParam(requesterIdParam, { min: 1, max: 99999999 });
      if (!requesterIdResult.isValid || requesterIdResult.value === null) {
        return NextResponse.json({ error: 'requesterId 格式錯誤' }, { status: 400 });
      }
      where.requesterId = requesterIdResult.value;
    }

    const items = await prisma.shiftExchangeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
            name: true, 
            position: true 
          } 
        }
      }
    });

    const normalized = items
      .map(normalizeItem)
      .filter((item): item is NonNullable<ReturnType<typeof normalizeItem>> => item !== null);
    
    return NextResponse.json(normalized);
  } catch (error) {
    console.error('Failed to fetch shift exchanges', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 創建調班申請
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
    
    // 用戶身份驗證
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    
    // 解析請求體
    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的調班申請資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const rawBody = parseResult.data;
    if (!isPlainObject(rawBody)) {
      return NextResponse.json({ error: '請提供有效的調班申請資料' }, { status: 400 });
    }
    const body = rawBody;

    // 獲取申請者 ID
    const requesterId = user.employeeId;

    // 僅支援員工自主申請調班
    const shiftDate = typeof body.shiftDate === 'string' ? body.shiftDate : '';
    const original = typeof body.originalShiftType === 'string' ? body.originalShiftType : '';
    const next = typeof body.newShiftType === 'string' ? body.newShiftType : '';
    const note = typeof body.reason === 'string' ? body.reason : '';
    const leaveType = typeof body.leaveType === 'string' ? body.leaveType : '';

    if (!shiftDate || !original || !next || !note) {
      return NextResponse.json({ error: '調班日期、原班別、新班別與申請原因為必填' }, { status: 400 });
    }

    const nextShift = await findActiveShiftDefinition(next);
    if (!nextShift) {
      return NextResponse.json({ error: '新班別不存在或已停用，請重新整理後再試' }, { status: 400 });
    }

    if (next === 'FDL' && !leaveType) {
      return NextResponse.json({ error: '調班為全日請假時，請選擇請假類型' }, { status: 400 });
    }

    const data: {
      requesterId: number;
      targetEmployeeId: number;
      originalWorkDate: string;
      targetWorkDate: string;
      requestReason: string;
      originalShiftType: string;
      newShiftType: string;
      leaveType: string | null;
      status: string;
    } = {
      requesterId,
      targetEmployeeId: requesterId,
      originalWorkDate: shiftDate,
      targetWorkDate: shiftDate,
      requestReason: note,
      originalShiftType: original,
      newShiftType: next,
      leaveType: next === 'FDL' ? leaveType : null,
      status: 'PENDING'
    };

    // 檢查凍結狀態
    const originalDateObj = new Date(data.originalWorkDate);
    const freezeCheck = await checkAttendanceFreeze(originalDateObj);

    if (freezeCheck.isFrozen) {
      const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
      return NextResponse.json({
        error: `該月份已被凍結，無法提交調班申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
      }, { status: 403 });
    }

    // 創建調班記錄
    const created = await prisma.shiftExchangeRequest.create({
      data,
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
        }
      }
    });
    
    // 建立審核實例
    await createApprovalForRequest({
      requestType: 'SHIFT_CHANGE',
      requestId: created.id,
      applicantId: created.requester?.id || created.requesterId,
      applicantName: created.requester?.name || '未知',
      department: created.requester?.department || null
    });
    
    // 正規化返回數據
    const normalized = normalizeItem(created);
    return NextResponse.json(normalized, { status: 201 });
    
  } catch (error) {
    console.error('Failed to create shift exchange', error);
    return NextResponse.json({ 
      error: '系統錯誤'
    }, { status: 500 });
  }
}
