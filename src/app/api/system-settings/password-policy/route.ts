import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

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

const SETTINGS_KEY = 'password_policy';

const DEFAULT_POLICY: PasswordPolicy = {
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

function getDefaultPolicy(): PasswordPolicy {
  return {
    ...DEFAULT_POLICY,
    customBlockedPasswords: [...DEFAULT_POLICY.customBlockedPasswords],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function toBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function toStringValue(value: unknown, fallback: string | undefined) {
  return typeof value === 'string' ? value : fallback;
}

function toStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    return fallback;
  }

  return value.map(item => item.trim()).filter(item => item.length > 0);
}

function validatePolicyPatch(policy: unknown) {
  if (!isPlainObject(policy)) {
    return { success: false as const, error: '缺少密碼政策資料' };
  }

  const booleanFields = [
    'requireUppercase',
    'requireLowercase',
    'requireNumbers',
    'requireSpecialChars',
    'preventPasswordReuse',
    'preventSequentialChars',
    'preventBirthdate',
    'preventCommonPasswords',
    'enableStrengthMeter',
    'allowAdminExceptions',
    'requireExceptionReason',
    'enablePasswordHints',
    'lockoutAfterFailedAttempts',
    'enableTwoFactorAuth',
    'notifyPasswordExpiration',
  ] as const;

  const integerFields = [
    'minLength',
    'expirationMonths',
    'passwordHistoryCount',
    'minimumStrengthScore',
    'maxFailedAttempts',
    'lockoutDurationMinutes',
    'notificationDaysBefore',
  ] as const;

  const patch: Partial<PasswordPolicy> = {};

  for (const field of booleanFields) {
    if (policy[field] !== undefined) {
      if (typeof policy[field] !== 'boolean') {
        return { success: false as const, error: `${field}格式無效` };
      }
      patch[field] = policy[field] as PasswordPolicy[typeof field];
    }
  }

  for (const field of integerFields) {
    if (policy[field] !== undefined) {
      if (typeof policy[field] !== 'number' || !Number.isInteger(policy[field])) {
        return { success: false as const, error: `${field}格式無效` };
      }
      patch[field] = policy[field] as PasswordPolicy[typeof field];
    }
  }

  if (policy.allowedSpecialChars !== undefined) {
    if (typeof policy.allowedSpecialChars !== 'string') {
      return { success: false as const, error: 'allowedSpecialChars格式無效' };
    }
    patch.allowedSpecialChars = policy.allowedSpecialChars;
  }

  if (policy.customBlockedPasswords !== undefined) {
    if (!Array.isArray(policy.customBlockedPasswords) || !policy.customBlockedPasswords.every(item => typeof item === 'string')) {
      return { success: false as const, error: 'customBlockedPasswords格式無效' };
    }
    patch.customBlockedPasswords = policy.customBlockedPasswords.map(item => item.trim()).filter(item => item.length > 0);
  }

  return { success: true as const, value: patch };
}

function normalizePolicy(input: Partial<PasswordPolicy>): PasswordPolicy {
  const defaults = getDefaultPolicy();

  return {
    minLength: toInteger(input.minLength, defaults.minLength),
    requireUppercase: toBoolean(input.requireUppercase, defaults.requireUppercase),
    requireLowercase: toBoolean(input.requireLowercase, defaults.requireLowercase),
    requireNumbers: toBoolean(input.requireNumbers, defaults.requireNumbers),
    requireSpecialChars: toBoolean(input.requireSpecialChars, defaults.requireSpecialChars),
    allowedSpecialChars: toStringValue(input.allowedSpecialChars, defaults.allowedSpecialChars),
    expirationMonths: toInteger(input.expirationMonths, defaults.expirationMonths),
    preventPasswordReuse: toBoolean(input.preventPasswordReuse, defaults.preventPasswordReuse),
    passwordHistoryCount: toInteger(input.passwordHistoryCount, defaults.passwordHistoryCount),
    preventSequentialChars: toBoolean(input.preventSequentialChars, defaults.preventSequentialChars),
    preventBirthdate: toBoolean(input.preventBirthdate, defaults.preventBirthdate),
    preventCommonPasswords: toBoolean(input.preventCommonPasswords, defaults.preventCommonPasswords),
    customBlockedPasswords: toStringArray(input.customBlockedPasswords, defaults.customBlockedPasswords),
    enableStrengthMeter: toBoolean(input.enableStrengthMeter, defaults.enableStrengthMeter),
    minimumStrengthScore: toInteger(input.minimumStrengthScore, defaults.minimumStrengthScore),
    allowAdminExceptions: toBoolean(input.allowAdminExceptions, defaults.allowAdminExceptions),
    requireExceptionReason: toBoolean(input.requireExceptionReason, defaults.requireExceptionReason),
    enablePasswordHints: toBoolean(input.enablePasswordHints, defaults.enablePasswordHints),
    lockoutAfterFailedAttempts: toBoolean(input.lockoutAfterFailedAttempts, defaults.lockoutAfterFailedAttempts),
    maxFailedAttempts: toInteger(input.maxFailedAttempts, defaults.maxFailedAttempts),
    lockoutDurationMinutes: toInteger(input.lockoutDurationMinutes, defaults.lockoutDurationMinutes),
    enableTwoFactorAuth: toBoolean(input.enableTwoFactorAuth, defaults.enableTwoFactorAuth),
    notifyPasswordExpiration: toBoolean(input.notifyPasswordExpiration, defaults.notifyPasswordExpiration),
    notificationDaysBefore: toInteger(input.notificationDaysBefore, defaults.notificationDaysBefore),
  };
}

async function getStoredPolicy(): Promise<PasswordPolicy> {
  const setting = await prisma.systemSettings.findUnique({
    where: { key: SETTINGS_KEY }
  });

  if (!setting?.value) {
    return getDefaultPolicy();
  }

  return normalizePolicy(
    safeParseSystemSettingsValue<Partial<PasswordPolicy>>(setting.value, {}, SETTINGS_KEY)
  );
}

// GET - 獲取密碼政策
export async function GET(request: NextRequest) {
  try {
    const userAuth = await getUserFromRequest(request);
    if (!userAuth) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const policy = await getStoredPolicy();

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
    const userAuth = await getUserFromRequest(request);
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

    const bodyResult = await safeParseJSON(request);

    if (!bodyResult.success) {
      return NextResponse.json(
        {
          error: bodyResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式'
        },
        { status: 400 }
      );
    }

    const body = bodyResult.data;

    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const policy = body.policy;

    const policyPatchResult = validatePolicyPatch(policy);
    if (!policyPatchResult.success) {
      return NextResponse.json({ error: policyPatchResult.error }, { status: 400 });
    }

    const existingPolicy = await getStoredPolicy();
    const normalizedPolicy = normalizePolicy({
      ...existingPolicy,
      ...policyPatchResult.value,
    });

    // 驗證政策資料
    if (normalizedPolicy.minLength < 4 || normalizedPolicy.minLength > 20) {
      return NextResponse.json({ error: '密碼最小長度必須在4-20之間' }, { status: 400 });
    }

    if (normalizedPolicy.expirationMonths < 0 || normalizedPolicy.expirationMonths > 24) {
      return NextResponse.json({ error: '密碼過期月數必須在0-24之間' }, { status: 400 });
    }

    if (normalizedPolicy.passwordHistoryCount < 0) {
      return NextResponse.json({ error: '密碼歷史記錄數量必須為非負整數' }, { status: 400 });
    }

    if (normalizedPolicy.minimumStrengthScore < 0 || normalizedPolicy.minimumStrengthScore > 4) {
      return NextResponse.json({ error: '密碼強度分數必須在0-4之間' }, { status: 400 });
    }

    if (normalizedPolicy.maxFailedAttempts < 1) {
      return NextResponse.json({ error: '最大失敗次數必須至少為1' }, { status: 400 });
    }

    if (normalizedPolicy.lockoutDurationMinutes < 0) {
      return NextResponse.json({ error: '鎖定分鐘數必須為非負整數' }, { status: 400 });
    }

    if (normalizedPolicy.notificationDaysBefore < 0) {
      return NextResponse.json({ error: '到期前通知天數必須為非負整數' }, { status: 400 });
    }

    // 更新或創建設定
    await prisma.systemSettings.upsert({
      where: { key: SETTINGS_KEY },
      update: {
        value: JSON.stringify(normalizedPolicy),
        updatedAt: new Date()
      },
      create: {
        key: SETTINGS_KEY,
        value: JSON.stringify(normalizedPolicy),
        description: '密碼安全政策設定'
      }
    });

    return NextResponse.json({ 
      message: '密碼政策更新成功',
      policy: normalizedPolicy 
    });

  } catch (error) {
    console.error('更新密碼政策失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
