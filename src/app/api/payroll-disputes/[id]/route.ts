/**
 * 薪資異議審核 API
 * GET: 取得單筆異議詳情
 * PUT: 審核異議（核准/拒絕）
 * DELETE: 撤回異議（僅限申請人且狀態為 PENDING）
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringOrNumber(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return null;
}

function parseRequiredFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return { value: null, isValid: false };
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return { value: null, isValid: false };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { value: null, isValid: false };
  }

  return { value: parsed, isValid: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const disputeIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

    if (!disputeIdResult.isValid || disputeIdResult.value === null) {
      return NextResponse.json({ error: '記錄ID 格式錯誤' }, { status: 400 });
    }

    const disputeId = disputeIdResult.value;

    const dispute = await prisma.payrollDispute.findUnique({
      where: { id: disputeId },
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
        payroll: true,
        reviewer: {
          select: {
            id: true,
            name: true
          }
        },
        adjustment: true
      }
    });

    if (!dispute) {
      return NextResponse.json({ error: '找不到該異議申請' }, { status: 404 });
    }

    // 非管理員只能看自己的異議
    if (user.role !== 'ADMIN' && user.role !== 'HR' && dispute.employeeId !== user.employeeId) {
      return NextResponse.json({ error: '無權限查看' }, { status: 403 });
    }

    return NextResponse.json({ success: true, dispute });

  } catch (error) {
    console.error('取得異議詳情失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // 只有管理員可以審核
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限審核' }, { status: 403 });
    }

    const { id } = await params;
    const disputeIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

    if (!disputeIdResult.isValid || disputeIdResult.value === null) {
      return NextResponse.json({ error: '記錄ID 格式錯誤' }, { status: 400 });
    }

    const disputeId = disputeIdResult.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的審核資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    if (!isPlainObject(data)) {
      return NextResponse.json({ error: '請提供有效的審核資料' }, { status: 400 });
    }

    const action = typeof data.action === 'string' ? data.action : undefined;
    const reviewNote = typeof data.reviewNote === 'string' ? data.reviewNote : undefined;
    const adjustedAmountInput = data.adjustedAmount;
    const adjustInYearInput = asStringOrNumber(data.adjustInYear);
    const adjustInMonthInput = asStringOrNumber(data.adjustInMonth);

    const dispute = await prisma.payrollDispute.findUnique({
      where: { id: disputeId },
      include: { employee: true }
    });

    if (!dispute) {
      return NextResponse.json({ error: '找不到該異議申請' }, { status: 404 });
    }

    if (dispute.status !== 'PENDING') {
      return NextResponse.json({ error: '該異議已審核過' }, { status: 400 });
    }

    if (action === 'approve') {
      // 核准異議
      if (
        adjustedAmountInput === undefined ||
        adjustedAmountInput === null ||
        adjustedAmountInput === '' ||
        adjustInYearInput === null ||
        adjustInYearInput === '' ||
        adjustInMonthInput === null ||
        adjustInMonthInput === ''
      ) {
        return NextResponse.json({ 
          error: '請填寫調整金額和調整月份' 
        }, { status: 400 });
      }

      const adjustedAmountResult = parseRequiredFiniteNumber(adjustedAmountInput);
      if (!adjustedAmountResult.isValid || adjustedAmountResult.value === null) {
        return NextResponse.json({ error: 'adjustedAmount 格式錯誤' }, { status: 400 });
      }

      const adjustInYearResult = parseIntegerQueryParam(adjustInYearInput, { min: 1900, max: 9999 });
      if (!adjustInYearResult.isValid || adjustInYearResult.value === null) {
        return NextResponse.json({ error: 'adjustInYear 格式錯誤' }, { status: 400 });
      }

      const adjustInMonthResult = parseIntegerQueryParam(adjustInMonthInput, { min: 1, max: 12 });
      if (!adjustInMonthResult.isValid || adjustInMonthResult.value === null) {
        return NextResponse.json({ error: 'adjustInMonth 格式錯誤' }, { status: 400 });
      }

      // 找到調整計入的薪資記錄
      const targetPayroll = await prisma.payrollRecord.findFirst({
        where: {
          employeeId: dispute.employeeId,
          payYear: adjustInYearResult.value,
          payMonth: adjustInMonthResult.value
        }
      });

      // 如果還沒有該月薪資記錄，先記錄調整資訊，等產生薪資時再計入
      const adjustmentData: {
        type: string;
        category: string;
        description: string;
        amount: number;
        originalYear: number;
        originalMonth: number;
        createdBy: number;
        payrollId?: number;
      } = {
        type: adjustedAmountResult.value >= 0 ? 'SUPPLEMENT' : 'DEDUCTION',
        category: dispute.type === 'OVERTIME_MISSING' ? 'OVERTIME' : 
                  dispute.type === 'LEAVE_MISSING' ? 'LEAVE' : 
                  dispute.type === 'ALLOWANCE_MISSING' ? 'ALLOWANCE' : 'OTHER',
        description: getAdjustmentDescription(dispute.type, dispute.payYear, dispute.payMonth),
        amount: Math.abs(adjustedAmountResult.value),
        originalYear: dispute.payYear,
        originalMonth: dispute.payMonth,
        createdBy: user.employeeId
      };

      // 使用交易確保數據一致性
      await prisma.$transaction(async (tx) => {
        // 更新異議狀態
        await tx.payrollDispute.update({
          where: { id: disputeId },
          data: {
            status: 'APPROVED',
            reviewedBy: user.employeeId,
            reviewedAt: new Date(),
            reviewNote: reviewNote || null,
            adjustedAmount: adjustedAmountResult.value,
            adjustInYear: adjustInYearResult.value,
            adjustInMonth: adjustInMonthResult.value
          }
        });

        // 如果有對應薪資記錄，建立調整項目
        if (targetPayroll) {
          await tx.payrollAdjustment.create({
            data: {
              ...adjustmentData,
              payrollId: targetPayroll.id,
              disputeId: disputeId
            }
          });

          // 更新薪資記錄的金額
          const adjustAmount = adjustedAmountResult.value;
          await tx.payrollRecord.update({
            where: { id: targetPayroll.id },
            data: {
              grossPay: { increment: adjustAmount },
              netPay: { increment: adjustAmount }
            }
          });
        }
      });

      return NextResponse.json({
        success: true,
        message: targetPayroll 
          ? `已核准，調整 $${Math.abs(adjustedAmountResult.value)} 計入 ${adjustInYearResult.value}年${adjustInMonthResult.value}月薪資`
          : `已核准，待 ${adjustInYearResult.value}年${adjustInMonthResult.value}月薪資產生時自動計入`
      });

    } else if (action === 'reject') {
      // 拒絕異議
      if (!reviewNote) {
        return NextResponse.json({ error: '請填寫拒絕原因' }, { status: 400 });
      }

      await prisma.payrollDispute.update({
        where: { id: disputeId },
        data: {
          status: 'REJECTED',
          reviewedBy: user.employeeId,
          reviewedAt: new Date(),
          reviewNote
        }
      });

      return NextResponse.json({
        success: true,
        message: '已拒絕異議申請'
      });

    } else {
      return NextResponse.json({ error: '無效的操作' }, { status: 400 });
    }

  } catch (error) {
    console.error('審核異議失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const disputeIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

    if (!disputeIdResult.isValid || disputeIdResult.value === null) {
      return NextResponse.json({ error: '記錄ID 格式錯誤' }, { status: 400 });
    }

    const disputeId = disputeIdResult.value;

    const dispute = await prisma.payrollDispute.findUnique({
      where: { id: disputeId }
    });

    if (!dispute) {
      return NextResponse.json({ error: '找不到該異議申請' }, { status: 404 });
    }

    // 只有申請人可以撤回自己的申請
    if (dispute.employeeId !== user.employeeId) {
      return NextResponse.json({ error: '無權限撤回' }, { status: 403 });
    }

    // 只能撤回待審核的申請
    if (dispute.status !== 'PENDING') {
      return NextResponse.json({ error: '只能撤回待審核的申請' }, { status: 400 });
    }

    await prisma.payrollDispute.delete({
      where: { id: disputeId }
    });

    return NextResponse.json({
      success: true,
      message: '已撤回異議申請'
    });

  } catch (error) {
    console.error('撤回異議失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 產生調整項目說明
function getAdjustmentDescription(type: string, year: number, month: number): string {
  const monthStr = `${year}年${month}月`;
  switch (type) {
    case 'OVERTIME_MISSING':
      return `${monthStr}加班費補發`;
    case 'LEAVE_MISSING':
      return `${monthStr}請假扣款調整`;
    case 'CALCULATION_ERROR':
      return `${monthStr}計算錯誤調整`;
    case 'ALLOWANCE_MISSING':
      return `${monthStr}津貼補發`;
    case 'DEDUCTION_ERROR':
      return `${monthStr}扣款錯誤調整`;
    default:
      return `${monthStr}薪資調整`;
  }
}
