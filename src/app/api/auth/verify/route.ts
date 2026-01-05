import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import jwt from 'jsonwebtoken';

export async function GET(request: NextRequest) {
  try {
    // 從 cookie 中獲取 token
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json(
        { error: '未找到驗證令牌' },
        { status: 401 }
      );
    }

    // 驗證 JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { 
      userId: number; 
      sessionId?: string;
    };

    // 查詢用戶資料
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            isActive: true
          }
        }
      }
    });

    if (!user) {
      return NextResponse.json(
        { error: '用戶不存在' },
        { status: 404 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: '用戶已被停用' },
        { status: 403 }
      );
    }

    // 檢查 sessionId 是否匹配（單一會話登入控制）
    if (decoded.sessionId && user.currentSessionId && decoded.sessionId !== user.currentSessionId) {
      return NextResponse.json(
        { 
          error: '您已在其他裝置登入，此會話已失效',
          code: 'SESSION_INVALID' // 特殊錯誤碼供前端識別
        },
        { status: 401 }
      );
    }

    if (!user.employee || !user.employee.isActive) {
      return NextResponse.json(
        { error: '員工資料不存在或已停用' },
        { status: 403 }
      );
    }

    // 返回用戶資訊（移除更新 lastLogin 避免每次驗證都寫入資料庫）
    return NextResponse.json({
      id: user.id,
      username: user.username,
      role: user.role,
      employee: {
        id: user.employee.id,
        employeeId: user.employee.employeeId,
        name: user.employee.name,
        department: user.employee.department,
        position: user.employee.position
      }
    });

  } catch (error) {
    console.error('驗證失敗:', error);
    
    if (error instanceof jwt.JsonWebTokenError) {
      return NextResponse.json(
        { error: '無效的驗證令牌' },
        { status: 401 }
      );
    }

    if (error instanceof jwt.TokenExpiredError) {
      return NextResponse.json(
        { error: '驗證令牌已過期' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}
