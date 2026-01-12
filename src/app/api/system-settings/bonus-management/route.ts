import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import jwt from 'jsonwebtoken';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// 驗證管理員權限
async function verifyAdmin(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;
    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as { userId: number };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true }
    });

    if (!user || user.role !== 'ADMIN') {
      return null;
    }

    return user;
  } catch {
    return null;
  }
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
      eligibilityRules: bonus.eligibilityRules ? JSON.parse(bonus.eligibilityRules as string) : {},
      paymentSchedule: bonus.paymentSchedule ? JSON.parse(bonus.paymentSchedule as string) : {}
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

    const body = await request.json();
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 10000) {
      return NextResponse.json(
        { error: '獎金設定資料過大' },
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

    // 驗證必要欄位
    if (!bonusType || !bonusTypeName) {
      return NextResponse.json(
        { error: '獎金代碼和名稱為必填欄位' },
        { status: 400 }
      );
    }

    // 檢查獎金代碼是否重複（排除自己）
    const existingBonus = await prisma.bonusConfiguration.findFirst({
      where: {
        bonusType,
        NOT: id ? { id } : undefined
      }
    });

    if (existingBonus) {
      return NextResponse.json(
        { error: '獎金代碼已存在' },
        { status: 400 }
      );
    }

    const bonusData = {
      bonusType,
      bonusTypeName,
      description,
      isActive: Boolean(isActive),
      defaultAmount: defaultAmount ? parseFloat(defaultAmount) : null,
      calculationFormula,
      eligibilityRules: eligibilityRules ? JSON.stringify(eligibilityRules) : undefined,
      paymentSchedule: paymentSchedule ? JSON.stringify(paymentSchedule) : undefined
    };

    let result;
    if (id) {
      // 更新現有獎金類型
      result = await prisma.bonusConfiguration.update({
        where: { id },
        data: bonusData
      });
    } else {
      // 新增獎金類型
      result = await prisma.bonusConfiguration.create({
        data: bonusData
      });
    }

    // 安全地解析 JSON 欄位
    const parseJsonField = (field: unknown) => {
      if (!field) return {};
      if (typeof field === 'object') return field;
      if (typeof field === 'string') {
        try {
          return JSON.parse(field);
        } catch {
          return {};
        }
      }
      return {};
    };

    return NextResponse.json({
      success: true,
      bonusType: {
        ...result,
        eligibilityRules: parseJsonField(result.eligibilityRules),
        paymentSchedule: parseJsonField(result.paymentSchedule)
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

    // 先獲取獎金類型
    const bonusTypeToDelete = await prisma.bonusConfiguration.findUnique({
      where: { id: parseInt(id) }
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
      where: { id: parseInt(id) }
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
