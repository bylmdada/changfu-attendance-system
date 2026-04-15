import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

interface DBItem {
  id: number;
  requesterId: number;
  targetEmployeeId: number;
  originalWorkDate: string;
  targetWorkDate: string;
  requestReason: string;
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
  originalShiftType?: string;
  newShiftType?: string;
  leaveType?: string;
  reason?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJSON(str: string) {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

// normalize a DB item to the frontend shape
function normalizeItem(it: DBItem) {
  const item = { ...it };

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
  let parsed: { type?: string; shiftDate?: string; original?: string; new?: string; note?: string; reason?: string; leaveType?: string } | null = null;
  if (typeof item.requestReason === 'string' && isJSON(item.requestReason)) {
    try { 
      parsed = JSON.parse(item.requestReason); 
    } catch { 
      parsed = null; 
    }
  }

  if (parsed && parsed.type === 'SELF_CHANGE') {
    item.shiftDate = parsed.shiftDate ?? item.originalWorkDate;
    item.originalShiftType = parsed.original ?? 'A';
    item.newShiftType = parsed.new ?? item.originalShiftType ?? 'A';
    item.leaveType = parsed.leaveType ?? '';
    item.reason = parsed.note ?? parsed.reason ?? '';
  } else {
    // for swap or generic, expose dates
    item.shiftDate = item.originalWorkDate || item.shiftDate || '';
    item.originalShiftType = item.originalShiftType || '';
    item.newShiftType = item.newShiftType || '';
    item.leaveType = '';
    item.reason = typeof item.requestReason === 'string' ? item.requestReason : (item.reason || '');
  }

  return item;
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

    // 非 ADMIN/HR 只看與本人有關的
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      where.OR = [
        { requesterId: user.employeeId },
        { targetEmployeeId: user.employeeId }
      ];
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

    const normalized = items.map(normalizeItem);
    
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

    // 檢測是否為自調班 (前端會送 shiftDate/originalShiftType/newShiftType)
    const isSelfChange = !!(body.shiftDate || (body.originalShiftType && body.newShiftType));

    let data: {
      requesterId: number;
      targetEmployeeId: number;
      originalWorkDate: string;
      targetWorkDate: string;
      requestReason: string;
      status: string;
    };

    if (isSelfChange) {
      // 自調班邏輯
      const shiftDate = String(body.shiftDate || body.originalWorkDate || body.shiftDateFrom || '');
      const original = String(body.originalShiftType || body.original || 'A');
      const next = String(body.newShiftType || body.new || original);
      const note = body.reason || body.requestReason || '';
      const leaveType = body.leaveType || ''; // 當選擇FDL時的請假類型

      data = {
        requesterId,
        targetEmployeeId: requesterId, // 自調班時目標員工就是自己
        originalWorkDate: shiftDate,
        targetWorkDate: shiftDate,
        requestReason: JSON.stringify({ 
          type: 'SELF_CHANGE', 
          shiftDate, 
          original, 
          new: next, 
          note,
          leaveType: next === 'FDL' ? leaveType : undefined // 只有FDL時才儲存leaveType
        }),
        status: 'PENDING'
      };
    } else {
      // 互調班邏輯
      const targetEmployeeIdResult = parseIntegerQueryParam(
        body.targetEmployeeId === undefined || body.targetEmployeeId === null || body.targetEmployeeId === ''
          ? null
          : String(body.targetEmployeeId),
        { defaultValue: requesterId, min: 1, max: 99999999 }
      );

      if (!targetEmployeeIdResult.isValid || targetEmployeeIdResult.value === null) {
        return NextResponse.json({ error: 'targetEmployeeId 格式錯誤' }, { status: 400 });
      }

      const targetEmployeeId = targetEmployeeIdResult.value;
      const originalWorkDate = String(body.originalWorkDate || body.shiftDate || body.shiftDateFrom || '');
      const targetWorkDate = String(body.targetWorkDate || body.shiftDate || body.shiftDateTo || originalWorkDate);
      const rawRequestReason = typeof body.requestReason === 'string'
        ? body.requestReason
        : typeof body.reason === 'string'
          ? body.reason
          : '';
      const requestReason = rawRequestReason || JSON.stringify(body) || '';

      data = {
        requesterId,
        targetEmployeeId,
        originalWorkDate,
        targetWorkDate,
        requestReason,
        status: 'PENDING'
      };
    }

    // 檢查凍結狀態
    const originalDateObj = new Date(data.originalWorkDate);
    const targetDateObj = new Date(data.targetWorkDate);
    const freezeCheck = await checkAttendanceFreeze(originalDateObj);

    if (freezeCheck.isFrozen) {
      const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW');
      return NextResponse.json({
        error: `該月份已被凍結，無法提交調班申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
      }, { status: 403 });
    }

    // 如果目標日期不同，也檢查目標日期
    if (data.originalWorkDate !== data.targetWorkDate) {
      const targetFreezeCheck = await checkAttendanceFreeze(targetDateObj);
      if (targetFreezeCheck.isFrozen) {
        const freezeDateStr = targetFreezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW');
        return NextResponse.json({
          error: `目標月份已被凍結，無法提交調班申請。凍結時間：${freezeDateStr}，操作者：${targetFreezeCheck.freezeInfo?.creator.name}`
        }, { status: 403 });
      }
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
