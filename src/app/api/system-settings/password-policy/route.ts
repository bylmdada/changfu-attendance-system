import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  allowedSpecialChars?: string;
  expirationMonths: number;
  preventPasswordReuse: boolean;
  passwordHistoryCount: number;
  preventSequentialChars: boolean;
  preventBirthdate: boolean;
  preventCommonPasswords: boolean;
  customBlockedPasswords: string[];
  enableStrengthMeter: boolean;
  minimumStrengthScore: number;
  allowAdminExceptions: boolean;
  requireExceptionReason: boolean;
  enablePasswordHints: boolean;
  lockoutAfterFailedAttempts: boolean;
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;
  enableTwoFactorAuth: boolean;
  notifyPasswordExpiration: boolean;
  notificationDaysBefore: number;
}

// GET - 獲取密碼政策
export async function GET() {
  try {
    const setting = await prisma.systemSettings.findUnique({
      where: { key: 'password_policy' }
    });

    let policy: PasswordPolicy = {
      minLength: 6,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: false,
      requireSpecialChars: false,
      allowedSpecialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
      expirationMonths: 0,
      preventPasswordReuse: false,
      passwordHistoryCount: 5,
      preventSequentialChars: true,
      preventBirthdate: true,
      preventCommonPasswords: true,
      customBlockedPasswords: [],
      enableStrengthMeter: true,
      minimumStrengthScore: 2,
      allowAdminExceptions: true,
      requireExceptionReason: true,
      enablePasswordHints: false,
      lockoutAfterFailedAttempts: true,
      maxFailedAttempts: 5,
      lockoutDurationMinutes: 30,
      enableTwoFactorAuth: false,
      notifyPasswordExpiration: true,
      notificationDaysBefore: 7
    };

    if (setting?.value) {
      try {
        policy = { ...policy, ...JSON.parse(setting.value) };
      } catch (error) {
        console.error('解析密碼政策失敗:', error);
      }
    }

    return NextResponse.json({ policy });
  } catch (error) {
    console.error('獲取密碼政策失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 更新密碼政策
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查 (密碼政策變更敏感)
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/password-policy');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '密碼政策變更請求過於頻繁',
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
    const userAuth = getUserFromRequest(request);
    if (!userAuth) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 4. 管理員權限檢查
    const user = await prisma.user.findUnique({
      where: { id: userAuth.userId }
    });

    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { policy } = await request.json();

    if (!policy) {
      return NextResponse.json({ error: '缺少密碼政策資料' }, { status: 400 });
    }

    // 驗證政策資料
    if (policy.minLength < 4 || policy.minLength > 20) {
      return NextResponse.json({ error: '密碼最小長度必須在4-20之間' }, { status: 400 });
    }

    if (policy.expirationMonths < 0 || policy.expirationMonths > 24) {
      return NextResponse.json({ error: '密碼過期月數必須在0-24之間' }, { status: 400 });
    }

    // 更新或創建設定
    await prisma.systemSettings.upsert({
      where: { key: 'password_policy' },
      update: {
        value: JSON.stringify(policy),
        updatedAt: new Date()
      },
      create: {
        key: 'password_policy',
        value: JSON.stringify(policy),
        description: '密碼安全政策設定'
      }
    });

    return NextResponse.json({ 
      message: '密碼政策更新成功',
      policy 
    });

  } catch (error) {
    console.error('更新密碼政策失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
