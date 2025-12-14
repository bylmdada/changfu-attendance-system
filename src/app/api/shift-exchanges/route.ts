import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

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
  reason?: string;
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
  let parsed: { type?: string; shiftDate?: string; original?: string; new?: string; note?: string; reason?: string } | null = null;
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
    item.reason = parsed.note ?? parsed.reason ?? '';
  } else {
    // for swap or generic, expose dates
    item.shiftDate = item.originalWorkDate || item.shiftDate || '';
    item.originalShiftType = item.originalShiftType || '';
    item.newShiftType = item.newShiftType || '';
    item.reason = typeof item.requestReason === 'string' ? item.requestReason : (item.reason || '');
  }

  return item;
}

// 查詢調班記錄列表
export async function GET(request: NextRequest) {
  console.log('📋 [GET] /api/shift-exchanges - 查詢調班記錄');
  
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      console.log('❌ [GET] 未授權訪問');
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    console.log('✅ [GET] 用戶驗證成功:', { userId: user.userId, employeeId: user.employeeId, role: user.role });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const requesterIdParam = searchParams.get('requesterId');

    console.log('🔍 [GET] 查詢參數:', { status, requesterIdParam });

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
      where.requesterId = parseInt(requesterIdParam);
    }

    console.log('🔎 [GET] Prisma 查詢條件:', JSON.stringify(where));

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
    console.log(`📊 [GET] 找到 ${normalized.length} 筆調班記錄`);
    
    return NextResponse.json(normalized);
  } catch (error) {
    console.error('❌ [GET] /api/shift-exchanges 錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 創建調班申請
export async function POST(request: NextRequest) {
  console.error('🚀🚀🚀 [SHIFT-EXCHANGE] POST 請求開始 🚀🚀🚀');
  console.error('=====================================');
  console.error('POST /api/shift-exchanges - 創建調班申請');
  console.error('=====================================');
  console.error('⏰ 請求時間:', new Date().toISOString());
  console.error('🌐 請求URL:', request.url);
  console.error('📧 請求方法:', request.method);
  
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

    console.error('✅ [STEP 1] 開始處理 POST 請求');
    
    // 用戶身份驗證
    const user = getUserFromRequest(request);
    if (!user) {
      console.error('❌ [STEP 2] 用戶未授權 - 無法獲取用戶信息');
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    console.error('✅ [STEP 3] 用戶身份驗證成功');
    console.error('👤 [STEP 4] 用戶信息:', JSON.stringify({
      userId: user.userId,
      employeeId: user.employeeId,
      username: user.username,
      role: user.role
    }));
    
    // 解析請求體
    const body = await request.json().catch(() => ({}));
    console.error('📝 [STEP 5] 請求體內容:', JSON.stringify(body));

    // 獲取申請者 ID
    const requesterId = user.employeeId;
    console.error('🆔 [STEP 6] 申請者 ID:', requesterId);

    // 檢測是否為自調班 (前端會送 shiftDate/originalShiftType/newShiftType)
    const isSelfChange = !!(body.shiftDate || (body.originalShiftType && body.newShiftType));
    console.error('🔄 [STEP 7] 是否為自調班:', isSelfChange);

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

      console.error('📋 [STEP 8A] 自調班數據解析:', {
        shiftDate,
        original,
        next,
        note
      });

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
          note 
        }),
        status: 'PENDING'
      };
    } else {
      // 互調班邏輯
      const targetEmployeeId = body.targetEmployeeId ? Number(body.targetEmployeeId) : requesterId;
      const originalWorkDate = String(body.originalWorkDate || body.shiftDate || body.shiftDateFrom || '');
      const targetWorkDate = String(body.targetWorkDate || body.shiftDate || body.shiftDateTo || originalWorkDate);
      const requestReason = body.requestReason || body.reason || JSON.stringify(body) || '';

      console.error('📋 [STEP 8B] 互調班數據解析:', {
        targetEmployeeId,
        originalWorkDate,
        targetWorkDate,
        requestReason
      });

      data = {
        requesterId,
        targetEmployeeId,
        originalWorkDate,
        targetWorkDate,
        requestReason,
        status: 'PENDING'
      };
    }

    console.error('💾 [STEP 9] 準備寫入數據庫的數據:', JSON.stringify(data));

    // 檢查凍結狀態
    const originalDateObj = new Date(data.originalWorkDate);
    const targetDateObj = new Date(data.targetWorkDate);
    const freezeCheck = await checkAttendanceFreeze(originalDateObj);

    if (freezeCheck.isFrozen) {
      const freezeDateStr = freezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW');
      console.error('❌ [STEP 9.5] 凍結檢查失敗:', {
        originalDate: data.originalWorkDate,
        freezeDate: freezeDateStr,
        creator: freezeCheck.freezeInfo?.creator.name
      });
      return NextResponse.json({
        error: `該月份已被凍結，無法提交調班申請。凍結時間：${freezeDateStr}，操作者：${freezeCheck.freezeInfo?.creator.name}`
      }, { status: 403 });
    }

    // 如果目標日期不同，也檢查目標日期
    if (data.originalWorkDate !== data.targetWorkDate) {
      const targetFreezeCheck = await checkAttendanceFreeze(targetDateObj);
      if (targetFreezeCheck.isFrozen) {
        const freezeDateStr = targetFreezeCheck.freezeInfo?.freezeDate.toLocaleString('zh-TW');
        console.error('❌ [STEP 9.6] 目標日期凍結檢查失敗:', {
          targetDate: data.targetWorkDate,
          freezeDate: freezeDateStr,
          creator: targetFreezeCheck.freezeInfo?.creator.name
        });
        return NextResponse.json({
          error: `目標月份已被凍結，無法提交調班申請。凍結時間：${freezeDateStr}，操作者：${targetFreezeCheck.freezeInfo?.creator.name}`
        }, { status: 403 });
      }
    }

    // 創建調班記錄
    console.error('🔄 [STEP 10] 開始創建數據庫記錄...');
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

    console.error('✅ [STEP 11] 數據庫記錄創建成功');
    console.error('📄 [STEP 12] 創建的記錄:', JSON.stringify({
      id: created.id,
      status: created.status,
      requesterId: created.requesterId,
      targetEmployeeId: created.targetEmployeeId,
      originalWorkDate: created.originalWorkDate,
      createdAt: created.createdAt
    }));
    
    // 驗證記錄是否真的保存了
    const verification = await prisma.shiftExchangeRequest.findUnique({
      where: { id: created.id }
    });
    console.error('🔍 [STEP 13] 記錄驗證結果:', verification ? '找到記錄' : '未找到記錄');
    
    // 統計總記錄數
    const totalCount = await prisma.shiftExchangeRequest.count();
    console.error('📊 [STEP 14] 數據庫中總記錄數:', totalCount);
    
    // 正規化返回數據
    const normalized = normalizeItem(created);
    console.error('📤 [STEP 15] 準備返回的正規化數據:', JSON.stringify({
      id: normalized.id,
      shiftDate: normalized.shiftDate,
      originalShiftType: normalized.originalShiftType,
      newShiftType: normalized.newShiftType,
      reason: normalized.reason,
      status: normalized.status
    }));
    
    console.error('🎉 [STEP 16] 調班申請處理完成，返回 201 成功響應');
    return NextResponse.json(normalized, { status: 201 });
    
  } catch (error) {
    console.error('💥 [ERROR] POST /api/shift-exchanges 發生錯誤:', error);
    console.error('🔍 [ERROR] 錯誤堆棧:', error instanceof Error ? error.stack : 'No stack trace');
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ 
      error: '系統錯誤', 
      details: errorMessage 
    }, { status: 500 });
  }
}
