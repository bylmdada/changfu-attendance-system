import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || (decoded.role !== 'ADMIN' && decoded.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const freezes = await prisma.attendanceFreeze.findMany({
      include: {
        creator: {
          select: {
            id: true,
            employeeId: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json({ freezes });
  } catch (error) {
    console.error('獲取凍結設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || (decoded.role !== 'ADMIN' && decoded.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { freezeDate, targetMonth, targetYear, description } = body;

    if (!freezeDate || !targetMonth || !targetYear) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 檢查是否已經存在相同的凍結設定
    const existingFreeze = await prisma.attendanceFreeze.findFirst({
      where: {
        targetMonth,
        targetYear,
        isActive: true
      }
    });

    if (existingFreeze) {
      return NextResponse.json({ error: '該月份已經被凍結' }, { status: 400 });
    }

    const freeze = await prisma.attendanceFreeze.create({
      data: {
        freezeDate: new Date(freezeDate),
        targetMonth: parseInt(targetMonth),
        targetYear: parseInt(targetYear),
        description,
        createdBy: decoded.employeeId
      },
      include: {
        creator: {
          select: {
            id: true,
            employeeId: true,
            name: true
          }
        }
      }
    });

    return NextResponse.json({ freeze });
  } catch (error) {
    console.error('創建凍結設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
