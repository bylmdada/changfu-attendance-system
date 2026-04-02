import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// GET - 取得審批流程設定
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || !['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const resourceType = searchParams.get('resourceType');

    const whereClause = resourceType ? { resourceType } : {};

    const flows = await prisma.approvalFlow.findMany({
      where: whereClause,
      orderBy: { resourceType: 'asc' }
    });

    // 解析 JSON 欄位
    const parsedFlows = flows.map(flow => ({
      ...flow,
      steps: JSON.parse(flow.steps),
      autoApproveRules: flow.autoApproveRules ? JSON.parse(flow.autoApproveRules) : null
    }));

    return NextResponse.json({
      success: true,
      flows: parsedFlows
    });
  } catch (error) {
    console.error('取得審批流程失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 建立/更新審批流程
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { name, resourceType, steps, autoApproveRules, isActive } = body;

    if (!name || !resourceType || !steps) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    // 驗證 resourceType
    const validTypes = ['LEAVE', 'OVERTIME', 'SHIFT_EXCHANGE', 'MISSED_CLOCK'];
    if (!validTypes.includes(resourceType)) {
      return NextResponse.json({ error: '無效的資源類型' }, { status: 400 });
    }

    // 驗證 steps 格式
    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: '審核步驟設定無效' }, { status: 400 });
    }

    const flow = await prisma.approvalFlow.upsert({
      where: { resourceType },
      update: {
        name,
        steps: JSON.stringify(steps),
        autoApproveRules: autoApproveRules ? JSON.stringify(autoApproveRules) : null,
        isActive: isActive ?? true
      },
      create: {
        name,
        resourceType,
        steps: JSON.stringify(steps),
        autoApproveRules: autoApproveRules ? JSON.stringify(autoApproveRules) : null,
        isActive: isActive ?? true
      }
    });

    return NextResponse.json({
      success: true,
      message: '審批流程設定已儲存',
      flow: {
        ...flow,
        steps: JSON.parse(flow.steps),
        autoApproveRules: flow.autoApproveRules ? JSON.parse(flow.autoApproveRules) : null
      }
    });
  } catch (error) {
    console.error('儲存審批流程失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
