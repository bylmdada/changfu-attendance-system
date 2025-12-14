import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import jwt from 'jsonwebtoken';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

interface AttendanceFreezeSettings {
  freezeDay: number;
  freezeTime: string;
  isEnabled: boolean;
  description: string;
}

// 驗證管理員權限
async function verifyAdmin(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;
    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as { userId: number };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true }
    });

    if (!user || user.role !== 'ADMIN') {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

// GET - 取得考勤凍結設定
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 查找現有設定
    const existingSettings = await prisma.systemSettings.findFirst({
      where: { key: 'attendance_freeze' }
    });

    let settings: AttendanceFreezeSettings = {
      freezeDay: 5,
      freezeTime: '18:00',
      isEnabled: true,
      description: '每月5日下午6點後，前一個月的考勤記錄將被凍結，無法修改。'
    };

    if (existingSettings) {
      try {
        const parsedValue = JSON.parse(existingSettings.value);
        settings = { ...settings, ...parsedValue };
      } catch (error) {
        console.error('解析設定值失敗:', error);
      }
    }

    return NextResponse.json({
      success: true,
      settings
    });

  } catch (error) {
    console.error('取得考勤凍結設定失敗:', error);
    return NextResponse.json(
      { error: '取得設定失敗' },
      { status: 500 }
    );
  }
}

// POST - 更新考勤凍結設定
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查 (系統設定變更較敏感)
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/attendance-freeze');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '系統設定操作過於頻繁，請稍後再試',
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

    // 3. 管理員權限驗證
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    
    // 4. 資料大小驗證 (防止資源耗盡)
    const jsonString = JSON.stringify(body);
    if (jsonString.length > 10000) { // 10KB限制
      return NextResponse.json(
        { error: '設定資料過大' },
        { status: 400 }
      );
    }
    const { freezeDay, freezeTime, isEnabled, description }: AttendanceFreezeSettings = body;

    // 驗證輸入
    if (typeof freezeDay !== 'number' || freezeDay < 1 || freezeDay > 31) {
      return NextResponse.json(
        { error: '凍結日期必須在1-31之間' },
        { status: 400 }
      );
    }

    if (!freezeTime || !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(freezeTime)) {
      return NextResponse.json(
        { error: '凍結時間格式不正確' },
        { status: 400 }
      );
    }

    if (typeof isEnabled !== 'boolean') {
      return NextResponse.json(
        { error: '啟用狀態必須是布林值' },
        { status: 400 }
      );
    }

    const settings: AttendanceFreezeSettings = {
      freezeDay,
      freezeTime,
      isEnabled,
      description: description || ''
    };

    // 更新或創建設定
    await prisma.systemSettings.upsert({
      where: { key: 'attendance_freeze' },
      update: {
        value: JSON.stringify(settings),
        updatedAt: new Date()
      },
      create: {
        key: 'attendance_freeze',
        value: JSON.stringify(settings),
        description: '考勤凍結設定'
      }
    });

    return NextResponse.json({
      success: true,
      settings,
      message: '設定已更新成功'
    });

  } catch (error) {
    console.error('更新考勤凍結設定失敗:', error);
    return NextResponse.json(
      { error: '更新設定失敗' },
      { status: 500 }
    );
  }
}
