import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

// GET - 取得目前生效的假別規則設定
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 取得目前生效的設定
    const config = await prisma.leaveRulesConfig.findFirst({
      where: { isActive: true },
      orderBy: { effectiveDate: 'desc' }
    });

    // 如果沒有設定，返回預設值
    if (!config) {
      return NextResponse.json({
        success: true,
        config: {
          id: null,
          // 育嬰留停
          parentalLeaveFlexible: true,
          parentalLeaveMaxDays: 30,
          parentalLeaveCombinedMax: 60,
          // 家庭照顧假
          familyCareLeaveMaxDays: 7,
          familyCareHourlyEnabled: true,
          familyCareHourlyMaxHours: 56,
          familyCareNoDeductAttendance: true,
          // 病假
          sickLeaveAnnualMax: 30,
          sickLeaveNoDeductDays: 10,
          sickLeaveHalfPay: true,
          // 特休假
          annualLeaveRollover: false,
          annualLeaveRolloverMax: 0,
          // 補休
          compLeaveRollover: false,
          compLeaveRolloverMax: 0,
          compLeaveExpiryMonths: 6,
          // 生效設定
          effectiveDate: new Date().toISOString().split('T')[0],
          isActive: true,
          description: '系統預設值'
        },
        isDefault: true
      });
    }

    return NextResponse.json({
      success: true,
      config: {
        ...config,
        effectiveDate: config.effectiveDate.toISOString().split('T')[0]
      },
      isDefault: false
    });
  } catch (error) {
    console.error('取得假別規則設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 新增或更新假別規則設定
export async function POST(request: NextRequest) {
  try {
    // 速率限制
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/leave-rules-config');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試' },
        { status: 429 }
      );
    }

    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 權限檢查
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const {
      parentalLeaveFlexible,
      parentalLeaveMaxDays,
      parentalLeaveCombinedMax,
      familyCareLeaveMaxDays,
      familyCareHourlyEnabled,
      familyCareHourlyMaxHours,
      familyCareNoDeductAttendance,
      sickLeaveAnnualMax,
      sickLeaveNoDeductDays,
      sickLeaveHalfPay,
      annualLeaveRollover,
      annualLeaveRolloverMax,
      compLeaveRollover,
      compLeaveRolloverMax,
      compLeaveExpiryMonths,
      effectiveDate,
      description
    } = body;

    // 驗證必要欄位
    if (!effectiveDate) {
      return NextResponse.json({ error: '請填寫生效日期' }, { status: 400 });
    }

    // 將舊設定設為非作用中
    await prisma.leaveRulesConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false }
    });

    // 建立新設定
    const config = await prisma.leaveRulesConfig.create({
      data: {
        parentalLeaveFlexible: parentalLeaveFlexible ?? true,
        parentalLeaveMaxDays: parseInt(parentalLeaveMaxDays) || 30,
        parentalLeaveCombinedMax: parseInt(parentalLeaveCombinedMax) || 60,
        familyCareLeaveMaxDays: parseInt(familyCareLeaveMaxDays) || 7,
        familyCareHourlyEnabled: familyCareHourlyEnabled ?? true,
        familyCareHourlyMaxHours: parseInt(familyCareHourlyMaxHours) || 56,
        familyCareNoDeductAttendance: familyCareNoDeductAttendance ?? true,
        sickLeaveAnnualMax: parseInt(sickLeaveAnnualMax) || 30,
        sickLeaveNoDeductDays: parseInt(sickLeaveNoDeductDays) || 10,
        sickLeaveHalfPay: sickLeaveHalfPay ?? true,
        annualLeaveRollover: annualLeaveRollover ?? false,
        annualLeaveRolloverMax: parseInt(annualLeaveRolloverMax) || 0,
        compLeaveRollover: compLeaveRollover ?? false,
        compLeaveRolloverMax: parseInt(compLeaveRolloverMax) || 0,
        compLeaveExpiryMonths: parseInt(compLeaveExpiryMonths) || 6,
        effectiveDate: new Date(effectiveDate),
        description: description || null,
        isActive: true
      }
    });

    return NextResponse.json({
      success: true,
      message: '假別規則設定已儲存',
      config: {
        ...config,
        effectiveDate: config.effectiveDate.toISOString().split('T')[0]
      }
    });
  } catch (error) {
    console.error('儲存假別規則設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
