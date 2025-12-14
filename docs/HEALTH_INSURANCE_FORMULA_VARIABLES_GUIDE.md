# 健保費計算公式與變數配置指南

## 文檔概述

本文檔詳細說明長富考勤系統中健保費計算的完整公式、所有相關變數以及配置管理方式。系統支援靈活的參數調整，確保能夠適應法規變更和不同的計算需求。

**更新日期**: 2025年9月4日
**版本**: 2.0
**適用法規**: 台灣全民健康保險法

## 健保費計算公式詳解

### 基本計算公式

```
每月健保費 = 投保金額 × 保險費率 × 員工負擔比例 × (本人 + 實際計費眷屬人數)
```

### 公式分解說明

#### 1. 投保金額 (Insured Amount)
- **定義**: 根據「全民健康保險投保金額分級表」對應的級距金額
- **變數名稱**: `insuredAmount`
- **取得方式**: 查表法，根據員工月薪總額對應分級表
- **更新頻率**: 政府調整時更新（通常每年檢討）

```typescript
// 投保金額查詢邏輯
function getInsuredAmount(monthlySalary: number): number {
  const level = INSURED_SALARY_TABLE.find(
    level => monthlySalary >= level.minSalary && monthlySalary <= level.maxSalary
  );
  return level ? level.insuredAmount : DEFAULT_MAX_INSURED_AMOUNT;
}
```

#### 2. 保險費率 (Premium Rate)
- **定義**: 健保總費率
- **變數名稱**: `premiumRate`
- **當前值**: 5.17%
- **可調整**: ✅ 支援動態調整
- **更新頻率**: 政府調整時更新

```typescript
interface HealthInsuranceConfig {
  premiumRate: number; // 預設: 0.0517 (5.17%)
}
```

#### 3. 員工負擔比例 (Employee Contribution Ratio)
- **定義**: 員工需承擔的健保費比例
- **變數名稱**: `employeeContributionRatio`
- **當前值**: 30%
- **負擔結構**:
  - 員工自付: 30%
  - 雇主負擔: 60%
  - 政府補助: 10%
- **可調整**: ✅ 支援動態調整

```typescript
interface HealthInsuranceConfig {
  employeeContributionRatio: number; // 預設: 0.30 (30%)
}
```

#### 4. 計費人數計算 (Insured Persons Count)
- **計算公式**: `本人(1) + min(實際眷屬人數, 最大眷屬限制)`
- **變數說明**:
  - `dependentsCount`: 員工申報的眷屬人數
  - `maxDependents`: 系統設定的最大眷屬限制（預設3位）
  - `actualDependents`: 實際計費眷屬人數
  - `totalInsuredPersons`: 總計費人數

```typescript
function calculateInsuredPersons(dependentsCount: number, maxDependents: number = 3): {
  actualDependents: number;
  totalInsuredPersons: number;
} {
  const actualDependents = Math.min(dependentsCount, maxDependents);
  const totalInsuredPersons = 1 + actualDependents; // 本人 + 眷屬
  
  return { actualDependents, totalInsuredPersons };
}
```

## 可調整變數詳細說明

### 核心配置變數

#### 1. 保險費率 (premiumRate)
```typescript
interface PremiumRateConfig {
  rate: number;                    // 費率值 (如: 0.0517)
  effectiveDate: Date;            // 生效日期
  description: string;            // 變更說明
  legalBasis: string;            // 法規依據
}

// 使用範例
const currentRate = {
  rate: 0.0517,
  effectiveDate: new Date('2024-01-01'),
  description: '2024年健保費率',
  legalBasis: '全民健康保險法第21條'
};
```

#### 2. 員工負擔比例 (employeeContributionRatio)
```typescript
interface ContributionRatioConfig {
  employeeRatio: number;          // 員工負擔比例
  employerRatio: number;          // 雇主負擔比例  
  governmentRatio: number;        // 政府負擔比例
  effectiveDate: Date;
  insureeCategory: string;        // 投保類別 (第一類至第六類)
}

// 第一類被保險人 (一般受僱員工)
const firstCategoryRatio = {
  employeeRatio: 0.30,     // 30%
  employerRatio: 0.60,     // 60%
  governmentRatio: 0.10,   // 10%
  effectiveDate: new Date('2024-01-01'),
  insureeCategory: '第一類'
};
```

#### 3. 眷屬人數上限 (maxDependents)
```typescript
interface DependentsLimitConfig {
  maxCount: number;               // 最大眷屬人數
  applyToAllCategories: boolean;  // 是否適用所有投保類別
  exceptions: string[];           // 例外情況說明
  effectiveDate: Date;
}

const dependentsLimit = {
  maxCount: 3,
  applyToAllCategories: true,
  exceptions: [],
  effectiveDate: new Date('2024-01-01')
};
```

#### 4. 投保金額分級表 (insuredSalaryTable)
```typescript
interface SalaryLevelConfig {
  level: number;                  // 級距編號
  minSalary: number;             // 月薪下限
  maxSalary: number;             // 月薪上限
  insuredAmount: number;         // 對應投保金額
  effectiveDate: Date;           // 生效日期
  isActive: boolean;             // 是否啟用
}

// 分級表範例
const salaryLevels: SalaryLevelConfig[] = [
  {
    level: 1,
    minSalary: 0,
    maxSalary: 25000,
    insuredAmount: 25200,
    effectiveDate: new Date('2024-01-01'),
    isActive: true
  },
  {
    level: 2,
    minSalary: 25001,
    maxSalary: 26400,
    insuredAmount: 26400,
    effectiveDate: new Date('2024-01-01'),
    isActive: true
  }
  // ... 更多級距
];
```

### 補充保費相關變數

#### 1. 補充保費費率 (supplementaryRate)
```typescript
interface SupplementaryInsuranceConfig {
  rate: number;                   // 補充保費費率 (預設: 2.17%)
  threshold: number;              // 門檻金額 (預設: 4倍投保金額上限)
  applicableIncome: string[];     // 適用收入類型
  effectiveDate: Date;
}

const supplementaryConfig = {
  rate: 0.0217,                   // 2.17%
  threshold: 186000 * 4,          // 744,000元
  applicableIncome: ['薪資所得', '執行業務所得', '股利所得'],
  effectiveDate: new Date('2024-01-01')
};
```

## 配置管理系統

### 配置結構設計

```typescript
interface HealthInsuranceSystemConfig {
  // 基本配置
  basic: {
    premiumRate: number;
    employeeContributionRatio: number;
    maxDependents: number;
    effectiveDate: Date;
    version: string;
  };
  
  // 投保金額分級表
  salaryLevels: SalaryLevelConfig[];
  
  // 補充保費配置
  supplementary: SupplementaryInsuranceConfig;
  
  // 特殊規則
  specialRules: {
    minimumWage: number;           // 基本工資
    maximumInsuredAmount: number;  // 最高投保金額
    calculationRounding: 'round' | 'floor' | 'ceil'; // 四捨五入規則
  };
  
  // 審計資訊
  audit: {
    createdBy: string;
    createdAt: Date;
    approvedBy: string;
    approvedAt: Date;
    changeReason: string;
  };
}
```

### 配置更新API

#### 1. 取得當前配置
```typescript
// GET /api/health-insurance/config
interface GetConfigResponse {
  success: boolean;
  data: HealthInsuranceSystemConfig;
  effectiveDate: Date;
  nextScheduledChange?: {
    effectiveDate: Date;
    changes: Partial<HealthInsuranceSystemConfig>;
  };
}
```

#### 2. 更新配置
```typescript
// PUT /api/health-insurance/config
interface UpdateConfigRequest {
  config: Partial<HealthInsuranceSystemConfig>;
  effectiveDate: Date;
  changeReason: string;
  previewOnly?: boolean; // 僅預覽，不實際更新
}

interface UpdateConfigResponse {
  success: boolean;
  message: string;
  preview?: {
    affectedEmployees: number;
    estimatedImpact: {
      totalIncrease: number;
      totalDecrease: number;
      averageChange: number;
    };
  };
}
```

#### 3. 驗證配置
```typescript
// POST /api/health-insurance/config/validate
interface ValidateConfigRequest {
  config: Partial<HealthInsuranceSystemConfig>;
}

interface ValidateConfigResponse {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}
```

## 計算範例與測試案例

### 基本計算範例

#### 範例1: 無眷屬員工
```typescript
const example1 = {
  input: {
    monthlySalary: 50000,
    dependentsCount: 0
  },
  calculation: {
    insuredAmount: 50600,           // 查表得出
    premiumRate: 0.0517,           // 5.17%
    employeeRatio: 0.30,           // 30%
    totalPersons: 1,               // 本人
    individualPremium: 785,        // 50600 × 5.17% × 30% = 785
    totalPremium: 785              // 785 × 1 = 785
  },
  formula: "50600 × 5.17% × 30% × 1 = 785"
};
```

#### 範例2: 2位眷屬員工
```typescript
const example2 = {
  input: {
    monthlySalary: 50000,
    dependentsCount: 2
  },
  calculation: {
    insuredAmount: 50600,
    premiumRate: 0.0517,
    employeeRatio: 0.30,
    actualDependents: 2,           // 實際眷屬 = min(2, 3) = 2
    totalPersons: 3,               // 本人 + 2位眷屬
    individualPremium: 785,
    totalPremium: 2355             // 785 × 3 = 2355
  },
  formula: "50600 × 5.17% × 30% × 3 = 2355"
};
```

#### 範例3: 超過上限眷屬員工
```typescript
const example3 = {
  input: {
    monthlySalary: 50000,
    dependentsCount: 5             // 申報5位眷屬
  },
  calculation: {
    insuredAmount: 50600,
    premiumRate: 0.0517,
    employeeRatio: 0.30,
    actualDependents: 3,           // 實際眷屬 = min(5, 3) = 3
    totalPersons: 4,               // 本人 + 3位眷屬 (上限)
    individualPremium: 785,
    totalPremium: 3140             // 785 × 4 = 3140
  },
  formula: "50600 × 5.17% × 30% × 4 = 3140",
  note: "眷屬人數超過上限3位，僅計算3位"
};
```

### 配置變更影響測試

#### 費率調整測試
```typescript
describe('費率調整影響測試', () => {
  test('費率從5.17%調整至5.5%', () => {
    const oldConfig = { premiumRate: 0.0517 };
    const newConfig = { premiumRate: 0.055 };
    
    const employee = {
      monthlySalary: 50000,
      dependentsCount: 2,
      insuredAmount: 50600
    };
    
    const oldPremium = calculateHealthInsurance(employee, oldConfig);
    const newPremium = calculateHealthInsurance(employee, newConfig);
    
    const increase = newPremium.totalPremium - oldPremium.totalPremium;
    const increasePercentage = (increase / oldPremium.totalPremium) * 100;
    
    expect(increasePercentage).toBeCloseTo(6.37); // (5.5-5.17)/5.17 ≈ 6.37%
  });
});
```

## 配置驗證規則

### 數值驗證
```typescript
const configValidationRules = {
  premiumRate: {
    min: 0.03,        // 最低3%
    max: 0.08,        // 最高8%
    precision: 4      // 小數點後4位
  },
  employeeContributionRatio: {
    min: 0.20,        // 最低20%
    max: 0.50,        // 最高50%
    precision: 2
  },
  maxDependents: {
    min: 0,
    max: 10,
    type: 'integer'
  },
  insuredAmount: {
    min: 25200,       // 最低投保金額
    max: 186000,      // 最高投保金額
    multipleOf: 100   // 必須是100的倍數
  }
};
```

### 邏輯驗證
```typescript
function validateHealthInsuranceConfig(config: HealthInsuranceSystemConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 1. 檢查比例總和
  const totalRatio = config.basic.employeeContributionRatio + 
                    config.basic.employerRatio + 
                    config.basic.governmentRatio;
  if (Math.abs(totalRatio - 1.0) > 0.001) {
    errors.push('負擔比例總和必須等於100%');
  }
  
  // 2. 檢查分級表連續性
  const sortedLevels = config.salaryLevels.sort((a, b) => a.level - b.level);
  for (let i = 1; i < sortedLevels.length; i++) {
    if (sortedLevels[i].minSalary !== sortedLevels[i-1].maxSalary + 1) {
      errors.push(`分級表級距${sortedLevels[i].level}與前一級距不連續`);
    }
  }
  
  // 3. 檢查生效日期
  if (config.basic.effectiveDate < new Date()) {
    warnings.push('配置生效日期已過期');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}
```

## 歷史版本管理

### 配置版本控制
```typescript
interface ConfigVersion {
  version: string;              // 版本號 (如: v2.1.0)
  config: HealthInsuranceSystemConfig;
  effectiveDate: Date;
  expiredDate?: Date;
  changeLog: string;
  rollbackSupported: boolean;
}

// 版本管理API
interface VersionManagement {
  // 取得版本歷史
  getVersionHistory(): Promise<ConfigVersion[]>;
  
  // 切換至指定版本
  switchToVersion(version: string): Promise<void>;
  
  // 比較版本差異
  compareVersions(v1: string, v2: string): Promise<ConfigDiff>;
  
  // 建立新版本
  createVersion(config: HealthInsuranceSystemConfig, changeLog: string): Promise<string>;
}
```

### 配置備份與恢復
```typescript
interface ConfigBackup {
  backupId: string;
  timestamp: Date;
  config: HealthInsuranceSystemConfig;
  triggerReason: 'manual' | 'automatic' | 'before_update';
  restorable: boolean;
}

// 備份策略
const backupStrategy = {
  automatic: {
    frequency: 'daily',
    retention: '90 days',
    beforeUpdate: true
  },
  manual: {
    retention: '1 year',
    description: 'required'
  }
};
```

## 監控與警報

### 配置異常監控
```typescript
interface ConfigMonitoring {
  // 計算結果異常檢測
  detectAnomalies(calculations: HealthInsuranceCalculation[]): Anomaly[];
  
  // 配置參數驗證
  validateParameters(config: HealthInsuranceSystemConfig): ValidationReport;
  
  // 影響評估
  assessImpact(oldConfig: HealthInsuranceSystemConfig, 
               newConfig: HealthInsuranceSystemConfig): ImpactAssessment;
}

interface Anomaly {
  type: 'calculation_error' | 'unusual_amount' | 'configuration_mismatch';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedEmployees: number;
  suggestedAction: string;
}
```

### 警報設定
```typescript
const alertRules = {
  // 計算結果異常
  calculationAnomaly: {
    enabled: true,
    threshold: {
      amountChange: 0.10,      // 金額變動超過10%
      affectedEmployees: 50    // 影響員工數超過50人
    },
    notification: ['email', 'system']
  },
  
  // 配置更新
  configurationUpdate: {
    enabled: true,
    requireApproval: true,
    notificationLevel: 'all_admins'
  }
};
```

## 測試與驗證

### 單元測試框架
```typescript
describe('健保費配置變數測試', () => {
  describe('費率調整測試', () => {
    test.each([
      [0.0517, 50000, 0, 785],
      [0.055, 50000, 0, 835],
      [0.05, 50000, 0, 759]
    ])('費率%f，薪資%d，眷屬%d，預期保費%d', (rate, salary, dependents, expected) => {
      const config = { premiumRate: rate };
      const result = calculateHealthInsurance(salary, dependents, config);
      expect(result.totalPremium).toBe(expected);
    });
  });
  
  describe('眷屬人數上限測試', () => {
    test('上限設為2時，5位眷屬只計算2位', () => {
      const config = { maxDependents: 2 };
      const result = calculateHealthInsurance(50000, 5, config);
      expect(result.actualDependents).toBe(2);
      expect(result.totalInsuredPersons).toBe(3);
    });
  });
});
```

### 整合測試
```typescript
describe('配置管理整合測試', () => {
  test('完整配置更新流程', async () => {
    // 1. 備份當前配置
    const backup = await configService.createBackup('test_update');
    
    // 2. 更新配置
    const newConfig = {
      premiumRate: 0.055,
      effectiveDate: new Date('2025-01-01')
    };
    await configService.updateConfig(newConfig);
    
    // 3. 驗證更新結果
    const current = await configService.getCurrentConfig();
    expect(current.basic.premiumRate).toBe(0.055);
    
    // 4. 測試回滾
    await configService.restoreFromBackup(backup.backupId);
    const restored = await configService.getCurrentConfig();
    expect(restored.basic.premiumRate).toBe(0.0517);
  });
});
```

## 最佳實踐建議

### 配置管理最佳實踐

1. **版本控制**
   - 所有配置變更都應有版本記錄
   - 使用語意化版本號 (Semantic Versioning)
   - 保留完整的變更歷史

2. **測試策略**
   - 在測試環境驗證所有配置變更
   - 進行影響評估和回歸測試
   - 準備緊急回滾方案

3. **審核流程**
   - 重大配置變更需多人審核
   - 記錄變更原因和法規依據
   - 建立變更通知機制

4. **監控警報**
   - 設定合理的異常檢測閾值
   - 建立多層次的通知機制
   - 定期檢查監控效果

### 效能優化建議

1. **緩存策略**
   ```typescript
   // 配置緩存
   const configCache = new Map<string, HealthInsuranceSystemConfig>();
   
   async function getCachedConfig(): Promise<HealthInsuranceSystemConfig> {
     const cacheKey = 'current_config';
     
     if (!configCache.has(cacheKey)) {
       const config = await loadConfigFromDatabase();
       configCache.set(cacheKey, config);
       
       // 設定緩存過期時間
       setTimeout(() => configCache.delete(cacheKey), 3600000); // 1小時
     }
     
     return configCache.get(cacheKey);
   }
   ```

2. **批量計算**
   ```typescript
   // 批量處理員工健保費計算
   async function batchCalculateHealthInsurance(
     employees: Employee[]
   ): Promise<HealthInsuranceCalculation[]> {
     const config = await getCachedConfig();
     
     return employees.map(employee => 
       calculateHealthInsurance(
         employee.baseSalary,
         employee.dependentsCount,
         config
       )
     );
   }
   ```

---

*本指南涵蓋了健保費計算的所有可調整變數和配置管理機制，確保系統能夠靈活應對法規變更和業務需求調整。建議定期檢查政府公告並及時更新相關配置。*

**文檔維護**:
- **版本**: 2.0
- **最後更新**: 2025年9月4日
- **維護負責人**: 系統配置管理團隊
- **審核週期**: 每月
