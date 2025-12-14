/**
 * 環境變數驗證模組
 * 
 * 在應用啟動時驗證必要的環境變數是否存在
 */

// 必要的環境變數定義
interface EnvVariable {
  name: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  validator?: (value: string) => boolean;
}

// 環境變數清單
const requiredEnvVariables: EnvVariable[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    description: '資料庫連接字串',
  },
  {
    name: 'JWT_SECRET',
    required: true,
    description: 'JWT 簽名密鑰',
    validator: (value) => value.length >= 32,
  },
  {
    name: 'NEXTAUTH_SECRET',
    required: true,
    description: 'NextAuth 密鑰',
    validator: (value) => value.length >= 32,
  },
  {
    name: 'NEXTAUTH_URL',
    required: true,
    description: '應用程式 URL',
    defaultValue: 'http://localhost:3000',
    validator: (value) => value.startsWith('http://') || value.startsWith('https://'),
  },
];

// 可選的環境變數
const optionalEnvVariables: EnvVariable[] = [
  {
    name: 'NODE_ENV',
    required: false,
    description: '運行環境',
    defaultValue: 'development',
    validator: (value) => ['development', 'production', 'test'].includes(value),
  },
  {
    name: 'RATE_LIMIT_MAX',
    required: false,
    description: '速率限制最大請求數',
    defaultValue: '100',
    validator: (value) => !isNaN(parseInt(value)) && parseInt(value) > 0,
  },
  {
    name: 'RATE_LIMIT_WINDOW_MS',
    required: false,
    description: '速率限制時間窗口（毫秒）',
    defaultValue: '60000',
    validator: (value) => !isNaN(parseInt(value)) && parseInt(value) > 0,
  },
];

// 驗證結果
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    required: number;
    optional: number;
    missing: number;
    invalid: number;
  };
}

/**
 * 驗證環境變數
 */
export function validateEnvVariables(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let missingCount = 0;
  let invalidCount = 0;

  // 檢查必要環境變數
  for (const envVar of requiredEnvVariables) {
    const value = process.env[envVar.name];

    if (!value) {
      if (envVar.defaultValue) {
        warnings.push(
          `[警告] ${envVar.name}: 未設定，使用預設值 "${envVar.defaultValue}"`
        );
      } else {
        errors.push(
          `[錯誤] ${envVar.name}: 必要環境變數未設定 - ${envVar.description}`
        );
        missingCount++;
      }
      continue;
    }

    if (envVar.validator && !envVar.validator(value)) {
      errors.push(
        `[錯誤] ${envVar.name}: 驗證失敗 - ${envVar.description}`
      );
      invalidCount++;
    }
  }

  // 檢查可選環境變數
  for (const envVar of optionalEnvVariables) {
    const value = process.env[envVar.name];

    if (!value) {
      if (envVar.defaultValue) {
        // 設定預設值（僅顯示，不實際設定）
        warnings.push(
          `[提示] ${envVar.name}: 使用預設值 "${envVar.defaultValue}"`
        );
      }
      continue;
    }

    if (envVar.validator && !envVar.validator(value)) {
      warnings.push(
        `[警告] ${envVar.name}: 格式可能有誤 - ${envVar.description}`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    summary: {
      required: requiredEnvVariables.length,
      optional: optionalEnvVariables.length,
      missing: missingCount,
      invalid: invalidCount,
    },
  };
}

/**
 * 在應用啟動時執行驗證
 */
export function checkEnvOnStartup(): void {
  const result = validateEnvVariables();

  console.log('\n========================================');
  console.log('        環境變數驗證結果');
  console.log('========================================');

  if (result.errors.length > 0) {
    console.log('\n❌ 錯誤:');
    result.errors.forEach((error) => console.log(`   ${error}`));
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  警告/提示:');
    result.warnings.forEach((warning) => console.log(`   ${warning}`));
  }

  console.log('\n📊 摘要:');
  console.log(`   必要變數: ${result.summary.required}`);
  console.log(`   缺少變數: ${result.summary.missing}`);
  console.log(`   無效變數: ${result.summary.invalid}`);

  if (result.isValid) {
    console.log('\n✅ 環境變數驗證通過');
  } else {
    console.log('\n❌ 環境變數驗證失敗');
    console.log('   請檢查 .env 檔案設定');
    
    // 在生產環境中，驗證失敗應終止啟動
    if (process.env.NODE_ENV === 'production') {
      console.log('\n⛔ 生產環境中必須修正所有錯誤');
      process.exit(1);
    }
  }

  console.log('========================================\n');
}

/**
 * 取得環境變數（帶預設值）
 */
export function getEnv(name: string, defaultValue?: string): string {
  const value = process.env[name];
  
  if (value !== undefined) {
    return value;
  }
  
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  
  throw new Error(`環境變數 ${name} 未設定且沒有預設值`);
}

/**
 * 取得環境變數（數字型態）
 */
export function getEnvNumber(name: string, defaultValue?: number): number {
  const value = process.env[name];
  
  if (value !== undefined) {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  
  throw new Error(`環境變數 ${name} 不是有效的數字`);
}

/**
 * 取得環境變數（布林型態）
 */
export function getEnvBoolean(name: string, defaultValue?: boolean): boolean {
  const value = process.env[name];
  
  if (value !== undefined) {
    return value === 'true' || value === '1' || value === 'yes';
  }
  
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  
  return false;
}

// 導出所有環境變數名稱（供 TypeScript 類型檢查）
export const ENV_KEYS = {
  DATABASE_URL: 'DATABASE_URL',
  JWT_SECRET: 'JWT_SECRET',
  NEXTAUTH_SECRET: 'NEXTAUTH_SECRET',
  NEXTAUTH_URL: 'NEXTAUTH_URL',
  NODE_ENV: 'NODE_ENV',
  RATE_LIMIT_MAX: 'RATE_LIMIT_MAX',
  RATE_LIMIT_WINDOW_MS: 'RATE_LIMIT_WINDOW_MS',
} as const;
