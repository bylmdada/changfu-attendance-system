/**
 * 離職申請詳情 API
 * GET: 取得單筆詳情
 * PUT: 審核/更新
 * DELETE: 撤回申請
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseRecordId(value: string) {
  const parsedId = parseIntegerQueryParam(value, { min: 1 });
  if (!parsedId.isValid || parsedId.value === null) {
    return null;
  }

  return parsedId.value;
}

function parseDateInput(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsedUtcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedUtcDate.getUTCFullYear() !== year ||
    parsedUtcDate.getUTCMonth() !== month - 1 ||
    parsedUtcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const recordId = parseRecordId(id);
    if (recordId === null) {
      return NextResponse.json({ error: '離職申請ID格式無效' }, { status: 400 });
    }

    const record = await prisma.resignationRecord.findUnique({
      where: { id: recordId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            hireDate: true
          }
        },
        handoverItems: {
          orderBy: [
            { category: 'asc' },
            { createdAt: 'asc' }
          ]
        }
      }
    });

    if (!record) {
      return NextResponse.json({ error: '找不到離職申請' }, { status: 404 });
    }

    // 權限檢查：員工只能看自己的
    if (user.role !== 'ADMIN' && user.role !== 'HR' && record.employeeId !== user.employeeId) {
      return NextResponse.json({ error: '無權限查看' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      record
    });

  } catch (error) {
    console.error('取得離職申請詳情失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    // 速率限制
    const rateLimitResult = await checkRateLimit(request, '/api/resignation');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const recordId = parseRecordId(id);
    if (recordId === null) {
      return NextResponse.json({ error: '離職申請ID格式無效' }, { status: 400 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success || !parsedBody.data) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const data = parsedBody.data;

    const record = await prisma.resignationRecord.findUnique({
      where: { id: recordId }
    });

    if (!record) {
      return NextResponse.json({ error: '找不到離職申請' }, { status: 404 });
    }

    // 管理員/HR：審核操作
    if (user.role === 'ADMIN' || user.role === 'HR') {
      const action = typeof data.action === 'string' ? data.action : undefined;
      const rejectionReason = normalizeOptionalString(data.rejectionReason);
      const notes = normalizeOptionalString(data.notes);
      const actualDate = data.actualDate;

      if (action === 'approve') {
        // 核准
        const updated = await prisma.resignationRecord.update({
          where: { id: recordId },
          data: {
            status: 'APPROVED',
            approvedById: user.userId,
            approvedAt: new Date(),
            notes
          },
          include: { employee: true }
        });

        return NextResponse.json({
          success: true,
          record: updated,
          message: '離職申請已核准'
        });

      } else if (action === 'reject') {
        // 拒絕
        if (!rejectionReason) {
          return NextResponse.json({ error: '請填寫拒絕原因' }, { status: 400 });
        }

        const updated = await prisma.resignationRecord.update({
          where: { id: recordId },
          data: {
            status: 'REJECTED',
            approvedById: user.userId,
            approvedAt: new Date(),
            rejectionReason
          },
          include: { employee: true }
        });

        return NextResponse.json({
          success: true,
          record: updated,
          message: '離職申請已拒絕'
        });

      } else if (action === 'start_handover') {
        // 開始交接
        const updated = await prisma.resignationRecord.update({
          where: { id: recordId },
          data: { status: 'IN_HANDOVER' },
          include: { employee: true, handoverItems: true }
        });

        return NextResponse.json({
          success: true,
          record: updated,
          message: '已進入交接階段'
        });

      } else if (action === 'complete') {
        // 完成離職
        const parsedActualDate = actualDate === undefined ? new Date() : parseDateInput(actualDate);
        if (!parsedActualDate) {
          return NextResponse.json({ error: '實際離職日格式無效' }, { status: 400 });
        }

        const updated = await prisma.resignationRecord.update({
          where: { id: recordId },
          data: {
            status: 'COMPLETED',
            actualDate: parsedActualDate
          },
          include: { employee: true }
        });

        // 停用員工帳號
        await prisma.employee.update({
          where: { id: record.employeeId },
          data: { isActive: false }
        });

        return NextResponse.json({
          success: true,
          record: updated,
          message: '離職流程已完成，員工帳號已停用'
        });
      }
    }

    // 員工：更新申請內容（僅限 PENDING 狀態）
    if (record.employeeId === user.employeeId && record.status === 'PENDING') {
      const expectedDate = data.expectedDate;
      const reason = normalizeOptionalString(data.reason);
      const reasonType = normalizeOptionalString(data.reasonType);
      const notes = normalizeOptionalString(data.notes);
      let parsedExpectedDate: Date | undefined;

      if (expectedDate !== undefined) {
        parsedExpectedDate = parseDateInput(expectedDate) ?? undefined;
        if (!parsedExpectedDate) {
          return NextResponse.json({ error: '預計離職日格式無效' }, { status: 400 });
        }
      }

      const updated = await prisma.resignationRecord.update({
        where: { id: recordId },
        data: {
          expectedDate: parsedExpectedDate,
          reason,
          reasonType,
          notes
        },
        include: { employee: true }
      });

      return NextResponse.json({
        success: true,
        record: updated,
        message: '離職申請已更新'
      });
    }

    return NextResponse.json({ error: '無權限操作' }, { status: 403 });

  } catch (error) {
    console.error('更新離職申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const recordId = parseRecordId(id);
    if (recordId === null) {
      return NextResponse.json({ error: '離職申請ID格式無效' }, { status: 400 });
    }

    const record = await prisma.resignationRecord.findUnique({
      where: { id: recordId }
    });

    if (!record) {
      return NextResponse.json({ error: '找不到離職申請' }, { status: 404 });
    }

    // 只能撤回自己的 PENDING 狀態申請
    if (record.employeeId !== user.employeeId) {
      return NextResponse.json({ error: '無權限撤回' }, { status: 403 });
    }

    if (record.status !== 'PENDING') {
      return NextResponse.json({ error: '只能撤回待審核的申請' }, { status: 400 });
    }

    await prisma.resignationRecord.delete({
      where: { id: recordId }
    });

    return NextResponse.json({
      success: true,
      message: '離職申請已撤回'
    });

  } catch (error) {
    console.error('撤回離職申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
