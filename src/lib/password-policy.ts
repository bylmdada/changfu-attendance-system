export interface PasswordPolicy {
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

export interface PasswordStrengthResult {
  isValid: boolean;
  score: number;
  feedback: string[];
  violations: string[];
  suggestions: string[];
  strengthLabel: string;
  strengthColor: string;
  passesPolicy: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
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

const COMMON_WEAK_PASSWORDS = [
  '123456', '123456789', 'qwerty', 'password', '12345678', '111111',
  'abc123', '1234567', 'password1', '12345', '1234567890', '123123',
  '000000', 'iloveyou', '1234', '1q2w3e4r', 'qwertyuiop', '123',
  'monkey', 'dragon', '654321', '666666', '123321', '1', 'admin'
];

const SEQUENTIAL_PATTERNS = [
  '123456789', '987654321', 'abcdefgh', 'zyxwvuts',
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm'
];

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

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getRandomIndex(max: number) {
  if (max <= 0) return 0;

  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % max;
  }

  return Math.floor(Math.random() * max);
}

function hasAllowedSpecialCharacter(password: string, allowedSpecialChars?: string) {
  const specials = allowedSpecialChars && allowedSpecialChars.length > 0
    ? allowedSpecialChars
    : '!@#$%^&*()_+-=[]{}|;:,.<>?';

  const regex = new RegExp(`[${escapeForRegex(specials)}]`);
  return regex.test(password);
}

export function getDefaultPasswordPolicy(): PasswordPolicy {
  return {
    ...DEFAULT_PASSWORD_POLICY,
    customBlockedPasswords: [...DEFAULT_PASSWORD_POLICY.customBlockedPasswords],
  };
}

export function normalizePasswordPolicy(input: Partial<PasswordPolicy>): PasswordPolicy {
  const defaults = getDefaultPasswordPolicy();

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

export function isPasswordPolicy(value: unknown): value is PasswordPolicy {
  return isPlainObject(value)
    && typeof value.minLength === 'number'
    && typeof value.requireUppercase === 'boolean'
    && typeof value.requireLowercase === 'boolean'
    && typeof value.requireNumbers === 'boolean'
    && typeof value.requireSpecialChars === 'boolean'
    && typeof value.preventSequentialChars === 'boolean'
    && typeof value.preventBirthdate === 'boolean'
    && typeof value.preventCommonPasswords === 'boolean'
    && typeof value.enableStrengthMeter === 'boolean'
    && typeof value.minimumStrengthScore === 'number'
    && Array.isArray(value.customBlockedPasswords)
    && value.customBlockedPasswords.every(password => typeof password === 'string');
}

export function evaluatePasswordStrength(password: string, policy: PasswordPolicy): PasswordStrengthResult {
  const results = {
    isValid: true,
    score: 0,
    feedback: [] as string[],
    violations: [] as string[],
    suggestions: [] as string[]
  };

  if (password.length < policy.minLength) {
    results.isValid = false;
    results.violations.push(`密碼長度至少需要${policy.minLength}位`);
    results.feedback.push(`目前長度：${password.length}，需要：${policy.minLength}`);
  } else {
    results.score += 1;
  }

  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    results.isValid = false;
    results.violations.push('需要包含大寫字母');
    results.suggestions.push('添加至少一個大寫字母');
  } else if (/[A-Z]/.test(password)) {
    results.score += 1;
  }

  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    results.isValid = false;
    results.violations.push('需要包含小寫字母');
    results.suggestions.push('添加至少一個小寫字母');
  } else if (/[a-z]/.test(password)) {
    results.score += 1;
  }

  if (policy.requireNumbers && !/[0-9]/.test(password)) {
    results.isValid = false;
    results.violations.push('需要包含數字');
    results.suggestions.push('添加至少一個數字');
  } else if (/[0-9]/.test(password)) {
    results.score += 1;
  }

  if (policy.requireSpecialChars && !hasAllowedSpecialCharacter(password, policy.allowedSpecialChars)) {
    results.isValid = false;
    results.violations.push('需要包含特殊字元');
    results.suggestions.push('添加至少一個特殊字元');
  } else if (hasAllowedSpecialCharacter(password, policy.allowedSpecialChars)) {
    results.score += 1;
  }

  if (policy.preventSequentialChars) {
    const hasSequential = SEQUENTIAL_PATTERNS.some(pattern =>
      password.toLowerCase().includes(pattern.toLowerCase()) ||
      password.includes(pattern)
    );

    const hasNumSequential = /(?:012|123|234|345|456|567|678|789|987|876|765|654|543|432|321|210)/.test(password);

    if (hasSequential || hasNumSequential) {
      results.isValid = false;
      results.violations.push('不能包含連續字符');
      results.suggestions.push('避免使用連續的字母或數字');
    }
  }

  if (policy.preventCommonPasswords) {
    const isCommon = COMMON_WEAK_PASSWORDS.some(weakPwd =>
      password.toLowerCase() === weakPwd.toLowerCase()
    );

    if (isCommon) {
      results.isValid = false;
      results.violations.push('這是常見的弱密碼');
      results.suggestions.push('使用更複雜且獨特的密碼');
    }
  }

  if (policy.customBlockedPasswords.length > 0) {
    const isBlocked = policy.customBlockedPasswords.some(blockedPwd =>
      password.toLowerCase() === blockedPwd.toLowerCase()
    );

    if (isBlocked) {
      results.isValid = false;
      results.violations.push('這個密碼已被系統禁用');
      results.suggestions.push('請選擇其他密碼');
    }
  }

  const uniqueChars = new Set(password.toLowerCase()).size;
  const diversity = uniqueChars / password.length;

  if (diversity > 0.7) {
    results.score += 1;
  } else if (diversity < 0.3) {
    results.suggestions.push('使用更多不同的字符');
  }

  const hasRepeatedChars = /(.)\1{2,}/.test(password);
  if (hasRepeatedChars) {
    results.suggestions.push('避免連續重複相同字符');
  }

  results.score = Math.min(5, Math.max(1, results.score));

  if (results.violations.length > 0) {
    results.score = Math.min(2, results.score);
  }

  const meetsStrengthThreshold = results.score >= Math.max(1, Math.min(5, policy.minimumStrengthScore));
  const passesPolicy = results.isValid && (!policy.enableStrengthMeter || meetsStrengthThreshold);

  if (policy.enableStrengthMeter && !meetsStrengthThreshold) {
    results.isValid = false;
    results.violations.push(`密碼強度至少需要達到 ${Math.max(1, Math.min(5, policy.minimumStrengthScore))} 分`);
    results.suggestions.push('增加字元多樣性並避免可預測的組合');
  }

  let strengthLabel = '';
  let strengthColor = '';
  switch (results.score) {
    case 1:
      strengthLabel = '很弱';
      strengthColor = 'red';
      break;
    case 2:
      strengthLabel = '弱';
      strengthColor = 'orange';
      break;
    case 3:
      strengthLabel = '普通';
      strengthColor = 'yellow';
      break;
    case 4:
      strengthLabel = '強';
      strengthColor = 'blue';
      break;
    default:
      strengthLabel = '很強';
      strengthColor = 'green';
      break;
  }

  return {
    ...results,
    strengthLabel,
    strengthColor,
    passesPolicy
  };
}

export function generatePasswordForPolicy(policy: PasswordPolicy, preferredLength = Math.max(policy.minLength, 12)) {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = policy.allowedSpecialChars && policy.allowedSpecialChars.length > 0
    ? policy.allowedSpecialChars
    : '!@#$%^&*()_+-=[]{}|;:,.<>?';

  const requiredPools = [
    policy.requireUppercase ? uppercase : '',
    policy.requireLowercase ? lowercase : '',
    policy.requireNumbers ? numbers : '',
    policy.requireSpecialChars ? special : '',
  ].filter(Boolean);

  const combinedPool = Array.from(new Set((requiredPools.length > 0
    ? requiredPools.join('')
    : `${uppercase}${lowercase}${numbers}${special}`
  ).split(''))).join('');

  if (!combinedPool) {
    throw new Error('無法依目前密碼政策產生臨時密碼');
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const chars: string[] = [];

    for (const pool of requiredPools) {
      chars.push(pool[getRandomIndex(pool.length)]);
    }

    while (chars.length < preferredLength) {
      chars.push(combinedPool[getRandomIndex(combinedPool.length)]);
    }

    for (let index = chars.length - 1; index > 0; index--) {
      const swapIndex = getRandomIndex(index + 1);
      [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
    }

    const password = chars.join('');
    if (evaluatePasswordStrength(password, policy).passesPolicy) {
      return password;
    }
  }

  throw new Error('無法依目前密碼政策產生臨時密碼');
}
