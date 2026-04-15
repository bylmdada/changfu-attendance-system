import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { buildSuccessPayload } from '@/lib/api-response';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function authorizePayrollConfigAccess(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
    return null;
  }

  return user;
}

function parseConfigId(id: string): number | null {
  const parsed = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

  if (!parsed.isValid || parsed.value === null) {
    return null;
  }

  return parsed.value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await authorizePayrollConfigAccess(request);
    if (!user) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const { id } = await params;
    const configId = parseConfigId(id);
    if (configId === null) {
      return NextResponse.json({ error: '無效的配置 ID' }, { status: 400 });
    }

    const config = await prisma.payrollItemConfig.findUnique({
      where: { id: configId }
    });

    if (!config) {
      return NextResponse.json({ error: '找不到薪資項目配置' }, { status: 404 });
    }

    return NextResponse.json(buildSuccessPayload({ config }));
  } catch (error) {
    console.error('獲取薪資項目配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await authorizePayrollConfigAccess(request);
    if (!user) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const { id } = await params;
    const configId = parseConfigId(id);
    if (configId === null) {
      return NextResponse.json({ error: '無效的配置 ID' }, { status: 400 });
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
    const isActive = isPlainObject(body) && typeof body.isActive === 'boolean' ? body.isActive : undefined;

    if (!code || !name || !type || !category) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const existingConfig = await prisma.payrollItemConfig.findUnique({
      where: { id: configId }
    });

    if (!existingConfig) {
      return NextResponse.json({ error: '找不到薪資項目配置' }, { status: 404 });
    }

    if (code !== existingConfig.code) {
      const duplicateCodeConfig = await prisma.payrollItemConfig.findUnique({
        where: { code }
      });

      if (duplicateCodeConfig && duplicateCodeConfig.id !== configId) {
        return NextResponse.json({ error: '項目代碼已存在' }, { status: 400 });
      }
    }

    const config = await prisma.payrollItemConfig.update({
      where: { id: configId },
      data: {
        code,
        name,
        type,
        category,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        description,
        isActive: typeof isActive === 'boolean' ? isActive : existingConfig.isActive
      }
    });

    return NextResponse.json(buildSuccessPayload({ config, message: '薪資項目配置已更新' }));
  } catch (error) {
    console.error('更新薪資項目配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await authorizePayrollConfigAccess(request);
    if (!user) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const { id } = await params;
    const configId = parseConfigId(id);
    if (configId === null) {
      return NextResponse.json({ error: '無效的配置 ID' }, { status: 400 });
    }

    const existingConfig = await prisma.payrollItemConfig.findUnique({
      where: { id: configId }
    });

    if (!existingConfig) {
      return NextResponse.json({ error: '找不到薪資項目配置' }, { status: 404 });
    }

    await prisma.payrollItemConfig.update({
      where: { id: configId },
      data: { isActive: false }
    });

    return NextResponse.json(buildSuccessPayload({ message: '薪資項目配置已停用' }));
  } catch (error) {
    console.error('停用薪資項目配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}