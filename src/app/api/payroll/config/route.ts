import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { buildSuccessPayload } from '@/lib/api-response';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 獲取所有薪資項目配置
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const configs = await prisma.payrollItemConfig.findMany({
      where: { isActive: true },
      orderBy: [
        { category: 'asc' },
        { sortOrder: 'asc' }
      ]
    });

    return NextResponse.json(buildSuccessPayload({ configs }));
  } catch (error) {
    console.error('獲取薪資項目配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 創建薪資項目配置
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

    const user = await getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const code = isPlainObject(body) && typeof body.code === 'string' ? body.code : undefined;
    const name = isPlainObject(body) && typeof body.name === 'string' ? body.name : undefined;
    const type = isPlainObject(body) && typeof body.type === 'string' ? body.type : undefined;
    const category = isPlainObject(body) && typeof body.category === 'string' ? body.category : undefined;
    const sortOrder = isPlainObject(body) && typeof body.sortOrder === 'number' ? body.sortOrder : undefined;
    const description = isPlainObject(body) && typeof body.description === 'string' ? body.description : undefined;

    if (!code || !name || !type || !category) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    // 檢查代碼是否已存在
    const existing = await prisma.payrollItemConfig.findUnique({
      where: { code }
    });

    if (existing) {
      return NextResponse.json({ error: '項目代碼已存在' }, { status: 400 });
    }

    const config = await prisma.payrollItemConfig.create({
      data: {
        code,
        name,
        type,
        category,
        sortOrder: sortOrder || 0,
        description
      }
    });

    return NextResponse.json(buildSuccessPayload({ config }), { status: 201 });
  } catch (error) {
    console.error('創建薪資項目配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
