import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptionalPositiveInteger(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}

function parseOptionalFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseOptionalBoolean(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'boolean' ? value : null;
}

function parseOptionalJsonObject(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  return isPlainObject(value) ? value : null;
}

// 驗證管理員權限
async function verifyAdmin(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

function safeParseBonusJson(field: unknown) {
  if (!field) {
    return {};
  }

  if (typeof field === 'object') {
    return field;
  }

  if (typeof field === 'string') {
    try {
      return JSON.parse(field);
    } catch {
      return {};
    }
  }

  return {};
}

// GET - 取得所有獎金類型
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const bonusTypes = await prisma.bonusConfiguration.findMany({
      orderBy: { createdAt: 'desc' }
    });

    // 解析 JSON 欄位
    const parsedBonusTypes = bonusTypes.map(bonus => ({
      ...bonus,
      eligibilityRules: safeParseBonusJson(bonus.eligibilityRules),
      paymentSchedule: safeParseBonusJson(bonus.paymentSchedule)
    }));

    return NextResponse.json({
      success: true,
      bonusTypes: parsedBonusTypes
    });

  } catch (error) {
    console.error('取得獎金類型失敗:', error);
    return NextResponse.json(
      { error: '取得獎金類型失敗' },
      { status: 500 }
    );
  }
}

// POST - 新增或更新獎金類型
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/bonus-management');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '獎金設定操作過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.retryAfter 
        },
        { 
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          }
        }
      );
    }

    // 2. CSRF保護檢查
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    // 3. 管理員權限驗證
    const user = await verifyAdmin(request);
    if (!user) {
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
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 10000) {
      return NextResponse.json(
        { error: '獎金設定資料過大' },
        { status: 400 }
      );
    }

    if (!isPlainObject(body)) {
      return NextResponse.json(
        { error: '請提供有效的設定資料' },
        { status: 400 }
      );
    }

    const { 
      id,
      bonusType, 
      bonusTypeName, 
      description, 
      isActive, 
      defaultAmount, 
      calculationFormula,
      eligibilityRules,
      paymentSchedule
    } = body;

    const normalizedBonusType = typeof bonusType === 'string' ? bonusType.trim() : '';
    const normalizedBonusTypeName = typeof bonusTypeName === 'string' ? bonusTypeName.trim() : '';
    const normalizedDescription = typeof description === 'string' ? description : null;
    const normalizedCalculationFormula = typeof calculationFormula === 'string' ? calculationFormula : null;
    const normalizedId = parseOptionalPositiveInteger(id);
    const normalizedIsActive = parseOptionalBoolean(isActive);
    const normalizedDefaultAmount = parseOptionalFiniteNumber(defaultAmount);
    const normalizedEligibilityRules = parseOptionalJsonObject(eligibilityRules);
    const normalizedPaymentSchedule = parseOptionalJsonObject(paymentSchedule);

    // 驗證必要欄位
    if (!normalizedBonusType || !normalizedBonusTypeName) {
      return NextResponse.json(
        { error: '獎金代碼和名稱為必填欄位' },
        { status: 400 }
      );
    }

    if (id !== undefined && normalizedId === null) {
      return NextResponse.json(
        { error: '無效的獎金類型ID' },
        { status: 400 }
      );
    }

    if (normalizedIsActive === null) {
      return NextResponse.json(
        { error: '啟用狀態必須為布林值' },
        { status: 400 }
      );
    }

    if (defaultAmount !== undefined && normalizedDefaultAmount === null) {
      return NextResponse.json(
        { error: '預設金額必須為有效數字' },
        { status: 400 }
      );
    }

    if (eligibilityRules !== undefined && normalizedEligibilityRules === null) {
      return NextResponse.json(
        { error: '資格規則格式無效' },
        { status: 400 }
      );
    }

    if (paymentSchedule !== undefined && normalizedPaymentSchedule === null) {
      return NextResponse.json(
        { error: '發放排程格式無效' },
        { status: 400 }
      );
    }

    // 檢查獎金代碼是否重複（排除自己）
    const existingBonus = await prisma.bonusConfiguration.findFirst({
      where: {
        bonusType: normalizedBonusType,
        NOT: typeof normalizedId === 'number' ? { id: normalizedId } : undefined
      }
    });

    if (existingBonus) {
      return NextResponse.json(
        { error: '獎金代碼已存在' },
        { status: 400 }
      );
    }

    const bonusData = {
      bonusType: normalizedBonusType,
      bonusTypeName: normalizedBonusTypeName,
      description: normalizedDescription,
      isActive: normalizedIsActive ?? false,
      defaultAmount: normalizedDefaultAmount,
      calculationFormula: normalizedCalculationFormula,
      eligibilityRules: normalizedEligibilityRules ? JSON.stringify(normalizedEligibilityRules) : undefined,
      paymentSchedule: normalizedPaymentSchedule ? JSON.stringify(normalizedPaymentSchedule) : undefined
    };

    let result;
    if (typeof normalizedId === 'number') {
      // 更新現有獎金類型
      result = await prisma.bonusConfiguration.update({
        where: { id: normalizedId },
        data: bonusData
      });
    } else {
      // 新增獎金類型
      result = await prisma.bonusConfiguration.create({
        data: bonusData
      });
    }

    // 安全地解析 JSON 欄位
    return NextResponse.json({
      success: true,
      bonusType: {
        ...result,
        eligibilityRules: safeParseBonusJson(result.eligibilityRules),
        paymentSchedule: safeParseBonusJson(result.paymentSchedule)
      }
    });

  } catch (error) {
    console.error('儲存獎金類型失敗:', error);
    return NextResponse.json(
      { error: '儲存獎金類型失敗' },
      { status: 500 }
    );
  }
}

// DELETE - 刪除獎金類型
export async function DELETE(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/bonus-management');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '獎金設定操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: '缺少獎金類型ID' },
        { status: 400 }
      );
    }

    const normalizedId = /^\d+$/.test(id) ? Number(id) : null;

    if (!normalizedId) {
      return NextResponse.json(
        { error: '無效的獎金類型ID' },
        { status: 400 }
      );
    }

    // 先獲取獎金類型
    const bonusTypeToDelete = await prisma.bonusConfiguration.findUnique({
      where: { id: normalizedId }
    });

    if (!bonusTypeToDelete) {
      return NextResponse.json(
        { error: '找不到指定的獎金類型' },
        { status: 404 }
      );
    }

    // 檢查是否有相關的獎金記錄
    const bonusRecords = await prisma.bonusRecord.findFirst({
      where: { 
        bonusType: bonusTypeToDelete.bonusType
      }
    });

    if (bonusRecords) {
      return NextResponse.json(
        { error: '此獎金類型已有發放記錄，無法刪除' },
        { status: 400 }
      );
    }

    await prisma.bonusConfiguration.delete({
      where: { id: normalizedId }
    });

    return NextResponse.json({
      success: true,
      message: '獎金類型已刪除'
    });

  } catch (error) {
    console.error('刪除獎金類型失敗:', error);
    return NextResponse.json(
      { error: '刪除獎金類型失敗' },
      { status: 500 }
    );
  }
}
