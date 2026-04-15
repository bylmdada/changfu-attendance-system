import { NextRequest, NextResponse } from 'next/server';
import { getAuthResultFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuthResultFromRequest(request);

    if (authResult.reason === 'missing_token') {
      return NextResponse.json(
        { error: '未找到驗證令牌' },
        { status: 401 }
      );
    }

    if (authResult.reason === 'session_invalid') {
      return NextResponse.json(
        {
          error: '您已在其他裝置登入，此會話已失效',
          code: 'SESSION_INVALID'
        },
        { status: 401 }
      );
    }

    if (authResult.reason === 'expired_token') {
      return NextResponse.json(
        { error: '驗證令牌已過期' },
        { status: 401 }
      );
    }

    const decoded = authResult.user;

    if (!decoded) {
      return NextResponse.json(
        { error: '無效的驗證令牌' },
        { status: 401 }
      );
    }

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

    return NextResponse.json(
      { error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}
