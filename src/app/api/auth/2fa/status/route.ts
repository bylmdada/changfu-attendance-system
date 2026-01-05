/**
 * 2FA 狀態查詢 API
 * GET - 取得用戶 2FA 狀態
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    
    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: '無效的 Token' }, { status: 401 });
    }

    // 取得用戶 2FA 狀態
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        twoFactorEnabled: true,
        role: true
      }
    });

    if (!dbUser) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    // 判斷是否需要 2FA（管理員和 HR）
    const requires2FA = dbUser.role === 'ADMIN' || dbUser.role === 'HR';

    return NextResponse.json({
      enabled: dbUser.twoFactorEnabled,
      required: requires2FA,
      role: dbUser.role
    });

  } catch (error) {
    console.error('取得 2FA 狀態失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
