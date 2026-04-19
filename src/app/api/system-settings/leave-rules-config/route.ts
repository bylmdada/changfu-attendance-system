import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { DEFAULT_LEAVE_RULES_SETTINGS } from '@/lib/leave-rules-config-defaults';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeParseJSON } from '@/lib/validation';

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseIntegerField(
  value: unknown,
  options: { min: number; max?: number }
): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }

  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '') {
    return null;
  }

  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isInteger(parsed) || parsed < options.min) {
    return null;
  }

  if (options.max !== undefined && parsed > options.max) {
    return null;
  }

  return parsed;
}

function parseBooleanField(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

// GET - 取得目前生效的假別規則設定
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
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
          ...DEFAULT_LEAVE_RULES_SETTINGS,
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

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

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
    } = body as Record<string, unknown>;

    // 驗證必要欄位
    const normalizedEffectiveDate = typeof effectiveDate === 'string' ? effectiveDate : '';

    if (!normalizedEffectiveDate) {
      return NextResponse.json({ error: '請填寫生效日期' }, { status: 400 });
    }

    const parsedEffectiveDate = parseDateOnly(normalizedEffectiveDate);
    if (!parsedEffectiveDate) {
      return NextResponse.json({ error: '生效日期格式無效' }, { status: 400 });
    }

    const parsedParentalLeaveFlexible = parseBooleanField(parentalLeaveFlexible);
    if (parsedParentalLeaveFlexible === null) {
      return NextResponse.json({ error: '育嬰留停單日申請設定格式無效' }, { status: 400 });
    }

    const parsedParentalLeaveMaxDays = parseIntegerField(parentalLeaveMaxDays, { min: 1 });
    if (parsedParentalLeaveMaxDays === null) {
      return NextResponse.json({ error: '育嬰留停個人上限必須為正整數' }, { status: 400 });
    }

    const parsedParentalLeaveCombinedMax = parseIntegerField(parentalLeaveCombinedMax, { min: 1 });
    if (parsedParentalLeaveCombinedMax === null) {
      return NextResponse.json({ error: '育嬰留停雙親合計上限必須為正整數' }, { status: 400 });
    }

    if (parsedParentalLeaveCombinedMax < parsedParentalLeaveMaxDays) {
      return NextResponse.json({ error: '雙親合計上限不得低於個人上限' }, { status: 400 });
    }

    const parsedFamilyCareLeaveMaxDays = parseIntegerField(familyCareLeaveMaxDays, { min: 0 });
    if (parsedFamilyCareLeaveMaxDays === null) {
      return NextResponse.json({ error: '家庭照顧假上限必須為非負整數' }, { status: 400 });
    }

    const parsedFamilyCareHourlyEnabled = parseBooleanField(familyCareHourlyEnabled);
    if (parsedFamilyCareHourlyEnabled === null) {
      return NextResponse.json({ error: '家庭照顧假事假補充設定格式無效' }, { status: 400 });
    }

    const parsedFamilyCareHourlyMaxHours = parseIntegerField(familyCareHourlyMaxHours, { min: 0 });
    if (parsedFamilyCareHourlyMaxHours === null) {
      return NextResponse.json({ error: '家庭照顧假事假補充時數上限必須為非負整數' }, { status: 400 });
    }

    const parsedFamilyCareNoDeductAttendance = parseBooleanField(familyCareNoDeductAttendance);
    if (parsedFamilyCareNoDeductAttendance === null) {
      return NextResponse.json({ error: '家庭照顧假全勤設定格式無效' }, { status: 400 });
    }

    const parsedSickLeaveAnnualMax = parseIntegerField(sickLeaveAnnualMax, { min: 1 });
    if (parsedSickLeaveAnnualMax === null) {
      return NextResponse.json({ error: '病假年度上限必須為正整數' }, { status: 400 });
    }

    const parsedSickLeaveNoDeductDays = parseIntegerField(sickLeaveNoDeductDays, { min: 0 });
    if (parsedSickLeaveNoDeductDays === null) {
      return NextResponse.json({ error: '病假免扣全勤天數必須為非負整數' }, { status: 400 });
    }

    if (parsedSickLeaveNoDeductDays > parsedSickLeaveAnnualMax) {
      return NextResponse.json({ error: '病假免扣全勤天數不得高於病假年度上限' }, { status: 400 });
    }

    const parsedSickLeaveHalfPay = parseBooleanField(sickLeaveHalfPay);
    if (parsedSickLeaveHalfPay === null) {
      return NextResponse.json({ error: '病假半薪設定格式無效' }, { status: 400 });
    }

    const parsedAnnualLeaveRollover = parseBooleanField(annualLeaveRollover);
    if (parsedAnnualLeaveRollover === null) {
      return NextResponse.json({ error: '特休遞延設定格式無效' }, { status: 400 });
    }

    const parsedAnnualLeaveRolloverMax = parseIntegerField(annualLeaveRolloverMax, { min: 0 });
    if (parsedAnnualLeaveRolloverMax === null) {
      return NextResponse.json({ error: '特休遞延上限必須為非負整數' }, { status: 400 });
    }

    const parsedCompLeaveRollover = parseBooleanField(compLeaveRollover);
    if (parsedCompLeaveRollover === null) {
      return NextResponse.json({ error: '補休遞延設定格式無效' }, { status: 400 });
    }

    const parsedCompLeaveRolloverMax = parseIntegerField(compLeaveRolloverMax, { min: 0 });
    if (parsedCompLeaveRolloverMax === null) {
      return NextResponse.json({ error: '補休遞延上限必須為非負整數' }, { status: 400 });
    }

    const parsedCompLeaveExpiryMonths = parseIntegerField(compLeaveExpiryMonths, { min: 1, max: 24 });
    if (parsedCompLeaveExpiryMonths === null) {
      return NextResponse.json({ error: '補休有效期必須為 1 到 24 個月的整數' }, { status: 400 });
    }

    if (description !== undefined && description !== null && typeof description !== 'string') {
      return NextResponse.json({ error: '說明備註格式無效' }, { status: 400 });
    }

    const newConfigData = {
      parentalLeaveFlexible: parsedParentalLeaveFlexible,
      parentalLeaveMaxDays: parsedParentalLeaveMaxDays,
      parentalLeaveCombinedMax: parsedParentalLeaveCombinedMax,
      familyCareLeaveMaxDays: parsedFamilyCareLeaveMaxDays,
      familyCareHourlyEnabled: parsedFamilyCareHourlyEnabled,
      familyCareHourlyMaxHours: parsedFamilyCareHourlyMaxHours,
      familyCareNoDeductAttendance: parsedFamilyCareNoDeductAttendance,
      sickLeaveAnnualMax: parsedSickLeaveAnnualMax,
      sickLeaveNoDeductDays: parsedSickLeaveNoDeductDays,
      sickLeaveHalfPay: parsedSickLeaveHalfPay,
      annualLeaveRollover: parsedAnnualLeaveRollover,
      annualLeaveRolloverMax: parsedAnnualLeaveRolloverMax,
      compLeaveRollover: parsedCompLeaveRollover,
      compLeaveRolloverMax: parsedCompLeaveRolloverMax,
      compLeaveExpiryMonths: parsedCompLeaveExpiryMonths,
      effectiveDate: parsedEffectiveDate,
      description: typeof description === 'string' && description.trim() ? description.trim() : null,
      isActive: true
    };

    // 使用交易避免舊設定先失效、但新設定建立失敗時留下空白狀態。
    const [, config] = await prisma.$transaction([
      prisma.leaveRulesConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false }
      }),
      prisma.leaveRulesConfig.create({
        data: newConfigData
      })
    ]);

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
