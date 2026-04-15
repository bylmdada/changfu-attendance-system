import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
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

// GET - 取得目前生效的法規參數設定（勞保與基本工資）
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 取得目前生效的設定（最新且 isActive = true）
    const config = await prisma.laborLawConfig.findFirst({
      where: { isActive: true },
      orderBy: { effectiveDate: 'desc' }
    });

    // 如果沒有設定，返回預設值
    if (!config) {
      return NextResponse.json({
        success: true,
        config: {
          id: null,
          basicWage: 29500,
          laborInsuranceRate: 0.115,
          laborInsuranceMax: 45800,
          laborEmployeeRate: 0.2,
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
    console.error('取得法規參數失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 新增或更新法規參數設定
export async function POST(request: NextRequest) {
  try {
    // 速率限制
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/labor-law-config');
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
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const bodyRecord = body as Record<string, unknown>;
    const basicWage = bodyRecord.basicWage;
    const laborInsuranceRate = bodyRecord.laborInsuranceRate;
    const laborInsuranceMax = bodyRecord.laborInsuranceMax;
    const laborEmployeeRate = bodyRecord.laborEmployeeRate;
    const effectiveDate = bodyRecord.effectiveDate;
    const description = bodyRecord.description;

    // 驗證必要欄位
    if (!effectiveDate) {
      return NextResponse.json({ error: '請填寫生效日期' }, { status: 400 });
    }

    const parsedEffectiveDate = parseDateOnly(effectiveDate);
    if (!parsedEffectiveDate) {
      return NextResponse.json({ error: '生效日期格式無效' }, { status: 400 });
    }

    const newConfigData = {
      basicWage: parseInt(String(basicWage)) || 29500,
      laborInsuranceRate: parseFloat(String(laborInsuranceRate)) || 0.115,
      laborInsuranceMax: parseInt(String(laborInsuranceMax)) || 45800,
      laborEmployeeRate: parseFloat(String(laborEmployeeRate)) || 0.2,
      effectiveDate: parsedEffectiveDate,
      description: typeof description === 'string' && description.trim() ? description : null,
      isActive: true
    };

    // 使用交易避免舊設定先失效、但新設定建立失敗時留下空白狀態。
    const [, config] = await prisma.$transaction([
      prisma.laborLawConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false }
      }),
      prisma.laborLawConfig.create({
        data: newConfigData
      })
    ]);

    return NextResponse.json({
      success: true,
      message: '法規參數設定已儲存',
      config: {
        ...config,
        effectiveDate: config.effectiveDate.toISOString().split('T')[0]
      }
    });
  } catch (error) {
    console.error('儲存法規參數失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE - 取得歷史設定記錄
export async function DELETE(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    // 取得所有設定歷史
    const configs = await prisma.laborLawConfig.findMany({
      orderBy: { effectiveDate: 'desc' }
    });

    return NextResponse.json({
      success: true,
      configs: configs.map(c => ({
        ...c,
        effectiveDate: c.effectiveDate.toISOString().split('T')[0],
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString()
      }))
    });
  } catch (error) {
    console.error('取得設定歷史失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
