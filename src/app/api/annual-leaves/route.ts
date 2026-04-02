import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const year = searchParams.get('year') || new Date().getFullYear().toString();

    // 建立篩選條件
    const where: {
      employeeId?: number;
      year: number;
    } = {
      year: parseInt(year)
    };
    
    // 如果是一般員工，只能查看自己的年假
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      where.employeeId = decoded.employeeId;
    } else if (employeeId) {
      where.employeeId = parseInt(employeeId);
    }

    const annualLeaves = await prisma.annualLeave.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            hireDate: true
          }
        }
      },
      orderBy: [
        { employee: { name: 'asc' } }
      ]
    });

    return NextResponse.json({ annualLeaves });
  } catch (error) {
    console.error('獲取年假記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/annual-leaves');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '年假操作過於頻繁，請稍後再試',
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

    // 3. 身份驗證
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 只有管理員和HR可以設定年假
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { employeeId, year, yearsOfService } = await request.json();

    if (!employeeId || !year || yearsOfService === undefined) {
      return NextResponse.json({ error: '員工ID、年份和服務年資為必填' }, { status: 400 });
    }

    // 計算年假天數（依據勞動基準法第38條）
    let totalDays = 0;
    if (yearsOfService < 0.5) {
      totalDays = 0;         // 未滿6個月
    } else if (yearsOfService < 1) {
      totalDays = 3;         // 6個月以上未滿1年
    } else if (yearsOfService < 2) {
      totalDays = 7;         // 1年以上未滿2年
    } else if (yearsOfService < 3) {
      totalDays = 10;        // 2年以上未滿3年
    } else if (yearsOfService < 5) {
      totalDays = 14;        // 3年以上未滿5年
    } else if (yearsOfService < 10) {
      totalDays = 15;        // 5年以上未滿10年
    } else {
      // 10年以上：15天 + 每滿1年加1天，最高30天
      totalDays = Math.min(30, 15 + Math.floor(yearsOfService - 10) + 1);
    }

    // 計算到期日（隔年12月31日）
    const expiryDate = new Date(year + 1, 11, 31);

    const annualLeave = await prisma.annualLeave.upsert({
      where: {
        employeeId_year: {
          employeeId: parseInt(employeeId),
          year: parseInt(year)
        }
      },
      update: {
        yearsOfService,
        totalDays,
        remainingDays: totalDays,
        expiryDate
      },
      create: {
        employeeId: parseInt(employeeId),
        year: parseInt(year),
        yearsOfService,
        totalDays,
        remainingDays: totalDays,
        expiryDate
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      annualLeave,
      message: '年假設定成功'
    });
  } catch (error) {
    console.error('設定年假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
