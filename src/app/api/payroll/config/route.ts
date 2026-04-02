import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

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

    return NextResponse.json({ configs });
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

    const body = await request.json();
    const { code, name, type, category, sortOrder, description } = body;

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

    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    console.error('創建薪資項目配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
