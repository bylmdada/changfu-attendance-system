import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// GET - 取得代理審核設定
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

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const delegatorId = searchParams.get('delegatorId');
    const onlyActive = searchParams.get('active') !== 'false';

    const now = new Date();
    const whereClause: {
      delegatorId?: number;
      isActive?: boolean;
      startDate?: { lte: Date };
      endDate?: { gte: Date };
    } = {};

    if (delegatorId) {
      whereClause.delegatorId = parseInt(delegatorId);
    }

    if (onlyActive) {
      whereClause.isActive = true;
      whereClause.startDate = { lte: now };
      whereClause.endDate = { gte: now };
    }

    const delegates = await prisma.approvalDelegate.findMany({
      where: whereClause,
      include: {
        delegator: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        delegate: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      },
      orderBy: { startDate: 'desc' }
    });

    // 解析 JSON 欄位
    const parsedDelegates = delegates.map(d => ({
      ...d,
      resourceTypes: d.resourceTypes ? JSON.parse(d.resourceTypes) : null
    }));

    return NextResponse.json({
      success: true,
      delegates: parsedDelegates
    });
  } catch (error) {
    console.error('取得代理審核設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 建立代理審核設定
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

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const body = await request.json();
    const { delegatorId, delegateId, startDate, endDate, resourceTypes } = body;

    // 驗證
    if (!delegatorId || !delegateId || !startDate || !endDate) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    if (delegatorId === delegateId) {
      return NextResponse.json({ error: '委託人與代理人不能相同' }, { status: 400 });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end <= start) {
      return NextResponse.json({ error: '結束日期必須晚於開始日期' }, { status: 400 });
    }

    // 權限檢查：只能設定自己的代理，或管理員可設定任何人
    if (decoded.role !== 'ADMIN' && decoded.employeeId !== delegatorId) {
      return NextResponse.json({ error: '只能設定自己的代理審核' }, { status: 403 });
    }

    // 檢查是否有重疊的代理設定
    const overlapping = await prisma.approvalDelegate.findFirst({
      where: {
        delegatorId: parseInt(delegatorId),
        isActive: true,
        OR: [
          { startDate: { lte: end }, endDate: { gte: start } }
        ]
      }
    });

    if (overlapping) {
      return NextResponse.json({ 
        error: '該時段已有代理設定，請先取消現有設定',
        existingDelegate: overlapping
      }, { status: 400 });
    }

    const delegate = await prisma.approvalDelegate.create({
      data: {
        delegatorId: parseInt(delegatorId),
        delegateId: parseInt(delegateId),
        startDate: start,
        endDate: end,
        resourceTypes: resourceTypes ? JSON.stringify(resourceTypes) : null,
        isActive: true
      },
      include: {
        delegator: {
          select: { id: true, name: true }
        },
        delegate: {
          select: { id: true, name: true }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: '代理審核設定已建立',
      delegate: {
        ...delegate,
        resourceTypes: delegate.resourceTypes ? JSON.parse(delegate.resourceTypes) : null
      }
    });
  } catch (error) {
    console.error('建立代理審核設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE - 取消代理審核設定
export async function DELETE(request: NextRequest) {
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

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    const existing = await prisma.approvalDelegate.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existing) {
      return NextResponse.json({ error: '找不到該代理設定' }, { status: 404 });
    }

    // 權限檢查
    if (decoded.role !== 'ADMIN' && decoded.employeeId !== existing.delegatorId) {
      return NextResponse.json({ error: '無權取消此代理設定' }, { status: 403 });
    }

    await prisma.approvalDelegate.update({
      where: { id: parseInt(id) },
      data: { isActive: false }
    });

    return NextResponse.json({
      success: true,
      message: '代理審核設定已取消'
    });
  } catch (error) {
    console.error('取消代理審核設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
