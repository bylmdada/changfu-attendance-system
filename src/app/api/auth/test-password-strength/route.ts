import { NextRequest, NextResponse } from 'next/server';

interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  preventSequentialChars: boolean;
  preventBirthdate: boolean;
  preventCommonPasswords: boolean;
  customBlockedPasswords: string[];
}

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

export async function POST(request: NextRequest) {
  try {
    const { password, policy }: { password: string; policy: PasswordPolicy } = await request.json();

    if (!password) {
      return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
    }

    const results = {
      isValid: true,
      score: 0,
      feedback: [] as string[],
      violations: [] as string[],
      suggestions: [] as string[]
    };

    // 1. 檢查密碼長度
    if (password.length < policy.minLength) {
      results.isValid = false;
      results.violations.push(`密碼長度至少需要${policy.minLength}位`);
      results.feedback.push(`目前長度：${password.length}，需要：${policy.minLength}`);
    } else {
      results.score += 1;
    }

    // 2. 檢查複雜性要求
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

    if (policy.requireSpecialChars && !/[^a-zA-Z0-9]/.test(password)) {
      results.isValid = false;
      results.violations.push('需要包含特殊字元');
      results.suggestions.push('添加至少一個特殊字元');
    } else if (/[^a-zA-Z0-9]/.test(password)) {
      results.score += 1;
    }

    // 3. 檢查連續字符
    if (policy.preventSequentialChars) {
      const hasSequential = SEQUENTIAL_PATTERNS.some(pattern => 
        password.toLowerCase().includes(pattern.toLowerCase()) ||
        password.includes(pattern)
      );
      
      // 檢查數字連續 (123, 987等)
      const hasNumSequential = /(?:012|123|234|345|456|567|678|789|987|876|765|654|543|432|321|210)/.test(password);
      
      if (hasSequential || hasNumSequential) {
        results.isValid = false;
        results.violations.push('不能包含連續字符');
        results.suggestions.push('避免使用連續的字母或數字');
      }
    }

    // 4. 檢查常見弱密碼
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

    // 5. 檢查自訂封鎖密碼
    if (policy.customBlockedPasswords && policy.customBlockedPasswords.length > 0) {
      const isBlocked = policy.customBlockedPasswords.some((blockedPwd: string) => 
        password.toLowerCase() === blockedPwd.toLowerCase()
      );
      
      if (isBlocked) {
        results.isValid = false;
        results.violations.push('這個密碼已被系統禁用');
        results.suggestions.push('請選擇其他密碼');
      }
    }

    // 6. 額外的強度檢查
    // 檢查字符多樣性
    const uniqueChars = new Set(password.toLowerCase()).size;
    const diversity = uniqueChars / password.length;
    
    if (diversity > 0.7) {
      results.score += 1;
    } else if (diversity < 0.3) {
      results.suggestions.push('使用更多不同的字符');
    }

    // 檢查重複字符
    const hasRepeatedChars = /(.)\1{2,}/.test(password);
    if (hasRepeatedChars) {
      results.suggestions.push('避免連續重複相同字符');
    }

    // 計算最終分數 (1-5)
    results.score = Math.min(5, Math.max(1, results.score));

    // 生成強度標籤
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
      case 5:
        strengthLabel = '很強';
        strengthColor = 'green';
        break;
    }

    // 如果有違規，分數不能超過2
    if (results.violations.length > 0) {
      results.score = Math.min(2, results.score);
    }

    return NextResponse.json({
      ...results,
      strengthLabel,
      strengthColor,
      passesPolicy: results.isValid
    });

  } catch (error) {
    console.error('密碼強度測試失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
