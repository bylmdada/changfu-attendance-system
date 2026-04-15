import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { isReviewerFor, isTerminalApprovalStatus } from '@/lib/approval-service';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 審核 CC API
 * GET: 取得我的待知悉/待同意項目
 * POST: 回應 CC（知悉/同意）
 */

// GET: 取得收到的 CC
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
    const status = searchParams.get('status') || 'PENDING';

    // 查詢收到的 CC
    const ccs = await prisma.approvalCC.findMany({
      where: {
        ccToEmployeeId: user.employeeId,
        status: status === 'all' ? undefined : status
      },
      include: {
        instance: {
          select: {
            id: true,
            requestType: true,
            requestId: true,
            applicantName: true,
            department: true,
            status: true,
            createdAt: true
          }
        },
        ccBy: {
          select: {
            id: true,
            name: true,
            department: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // 請求類型名稱對照
    const TYPE_NAMES: Record<string, string> = {
      LEAVE: '請假申請',
      OVERTIME: '加班申請',
      MISSED_CLOCK: '補打卡申請',
      SHIFT_CHANGE: '班表異動',
      SHIFT_SWAP: '換班申請',
      PURCHASE: '採購申請',
      RESIGNATION: '離職申請',
      PAYROLL_DISPUTE: '薪資爭議',
      DEPENDENT_APP: '眷屬加保',
      ANNOUNCEMENT: '公告'
    };

    const result = ccs.map(cc => ({
      id: cc.id,
      instanceId: cc.instanceId,
      requestType: cc.instance.requestType,
      requestTypeName: TYPE_NAMES[cc.instance.requestType] || cc.instance.requestType,
      requestId: cc.instance.requestId,
      applicantName: cc.instance.applicantName,
      department: cc.instance.department,
      ccType: cc.ccType,
      ccTypeName: cc.ccType === 'ACKNOWLEDGE' ? '待知悉' : '待同意',
      reason: cc.reason,
      ccByName: cc.ccBy.name,
      status: cc.status,
      statusName: cc.status === 'PENDING' ? '待處理' : 
                  cc.status === 'ACKNOWLEDGED' ? '已知悉' : '已同意',
      createdAt: cc.createdAt
    }));

    // 統計
    const pendingCount = ccs.filter(cc => cc.status === 'PENDING').length;

    return NextResponse.json({
      success: true,
      ccs: result,
      stats: {
        pending: pendingCount,
        total: ccs.length
      }
    });
  } catch (error) {
    console.error('取得 CC 失敗:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}

// POST: 建立 CC 或回應 CC
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const action = isPlainObject(body) && typeof body.action === 'string'
      ? body.action
      : undefined;

    // CREATE: 建立新 CC
    if (action === 'CREATE') {
      const instanceId = isPlainObject(body) && typeof body.instanceId === 'number'
        ? body.instanceId
        : undefined;
      const ccToEmployeeId = isPlainObject(body) && typeof body.ccToEmployeeId === 'number'
        ? body.ccToEmployeeId
        : undefined;
      const ccToName = isPlainObject(body) && typeof body.ccToName === 'string'
        ? body.ccToName
        : undefined;
      const ccType = isPlainObject(body) && typeof body.ccType === 'string'
        ? body.ccType
        : undefined;
      const reason = isPlainObject(body) && typeof body.reason === 'string'
        ? body.reason
        : undefined;
      
      if (!instanceId || !ccToEmployeeId || !ccToName) {
        return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
      }

      const instance = await prisma.approvalInstance.findUnique({
        where: { id: instanceId },
        select: {
          id: true,
          currentLevel: true,
          department: true,
          status: true
        }
      });

      if (!instance) {
        return NextResponse.json({ error: '找不到審核項目' }, { status: 404 });
      }

      if (isTerminalApprovalStatus(instance.status)) {
        return NextResponse.json({ error: '此審核已完成，無法建立 CC' }, { status: 409 });
      }

      if (instance.currentLevel === 1) {
        if (user.role !== 'ADMIN') {
          if (!instance.department) {
            return NextResponse.json({ error: '此審核缺少部門資訊，無法建立 CC' }, { status: 400 });
          }

          const reviewerPermission = await isReviewerFor(user.employeeId, instance.department);
          if (!reviewerPermission.isReviewer) {
            return NextResponse.json({ error: '無權為此審核建立 CC' }, { status: 403 });
          }
        }
      } else if (user.role !== 'ADMIN' && user.role !== 'HR') {
        return NextResponse.json({ error: '無權為此審核建立 CC' }, { status: 403 });
      }

      // 取得發起者資訊
      const ccByEmployee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, name: true }
      });

      if (!ccByEmployee) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
      }

      // 建立 CC 記錄
      const newCC = await prisma.approvalCC.create({
        data: {
          instanceId,
          ccByEmployeeId: user.employeeId,
          ccByName: ccByEmployee.name,
          ccToEmployeeId,
          ccToName,
          ccType: ccType || 'ACKNOWLEDGE',
          reason: reason || null,
          status: 'PENDING'
        }
      });

      return NextResponse.json({
        success: true,
        message: `已${ccType === 'AGREE' ? '轉會同意' : '轉會知悉'}給 ${ccToName}`,
        cc: newCC
      });
    }

    // RESPOND: 回應 CC
    const ccId = isPlainObject(body) && typeof body.ccId === 'number'
      ? body.ccId
      : undefined;
    const response = isPlainObject(body) && typeof body.response === 'string'
      ? body.response
      : undefined;

    if (!ccId || !action) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    if (!['ACKNOWLEDGE', 'AGREE'].includes(action)) {
      return NextResponse.json({ error: '無效的操作' }, { status: 400 });
    }

    // 查詢 CC
    const cc = await prisma.approvalCC.findUnique({
      where: { id: ccId }
    });

    if (!cc) {
      return NextResponse.json({ error: 'CC 記錄不存在' }, { status: 404 });
    }

    if (cc.ccToEmployeeId !== user.employeeId) {
      return NextResponse.json({ error: '無權處理此 CC' }, { status: 403 });
    }

    if (cc.status !== 'PENDING') {
      return NextResponse.json({ error: '此 CC 已處理' }, { status: 400 });
    }

    // 更新 CC 狀態
    const updatedCC = await prisma.approvalCC.update({
      where: { id: ccId },
      data: {
        status: action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'AGREED',
        respondedAt: new Date(),
        response: response || null
      }
    });

    return NextResponse.json({
      success: true,
      message: action === 'ACKNOWLEDGE' ? '已確認知悉' : '已確認同意',
      cc: updatedCC
    });
  } catch (error) {
    console.error('處理 CC 失敗:', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}
