# 補充保費計算系統技術文檔

## 概述

補充保費（二代健保）是台灣全民健康保險制度的一部分，針對特定類型的收入收取額外保費。本系統實現完整的補充保費計算邏輯，包括獎金、兼職薪資等不同收入類型的計算。

## 計算公式

### 基本公式
```
補充保費 = 計費基礎 × 費率 (2.11%)
```

### 費率更新
- **2024年費率**: 2.11% (已更新，之前為2.17%)
- 費率可能根據政府政策調整，系統支援動態配置

## 計算類型

### 1. 獎金補充保費 (Bonus Supplementary Premium)

#### 適用項目
- 年終獎金
- 三節獎金 (春節、端午、中秋)
- 績效獎金
- 其他非每月固定發放的獎金

#### 計算邏輯
```typescript
interface BonusSupplementaryCalculation {
  employeeInsuredAmount: number;    // 員工健保投保金額
  currentYearBonusTotal: number;    // 本年度已發獎金總額
  newBonusAmount: number;          // 本次發放獎金金額
  exemptThreshold: number;         // 免扣門檻 (投保金額 × 4)
  calculationBase: number;         // 計費基數
  premiumAmount: number;           // 補充保費金額
}
```

#### 計算步驟
1. **取得投保金額**: 根據員工基本薪資查找對應的健保投保金額
2. **計算免扣門檻**: 投保金額 × 4
3. **累計年度獎金**: 本年度已發放獎金 + 本次獎金
4. **判斷是否超過門檻**:
   - 若累計未超過門檻 → 免扣
   - 若累計超過門檻 → 計算超出部分
5. **計算補充保費**: 計費基數 × 2.11% (四捨五入)

#### 實例計算
```typescript
// 範例：林小姐投保金額50,600元
const example = {
  insuredAmount: 50600,
  exemptThreshold: 50600 * 4,      // 202,400元
  previousBonus: 150000,           // 已發獎金
  currentBonus: 100000,            // 本次獎金
  
  // 計算過程
  totalBonus: 150000 + 100000,     // 250,000元
  exceededAmount: 250000 - 202400, // 47,600元
  premiumAmount: Math.round(47600 * 0.0211), // 1,004元
};
```

### 2. 薪資補充保費 (Salary Supplementary Premium)

#### 適用條件
單月薪資超過投保金額上限4倍時收取

#### 計算方式
```typescript
function calculateSupplementaryHealthInsurance(monthlySalary: number): number {
  const threshold = 186000 * 4; // 744,000元 (2024年投保金額上限)
  const rate = 0.0211;          // 2.11%
  
  if (monthlySalary > threshold) {
    return Math.round((monthlySalary - threshold) * rate);
  }
  return 0;
}
```

### 3. 兼職薪資補充保費 (Part-time Supplementary Premium)

#### 適用條件
在非主要投保單位領取薪資，且單次給付達基本工資以上

#### 計算規則
- **門檻**: 基本工資 (2024年為27,470元)
- **計費**: 全額計算，不扣除門檻
- **費率**: 2.11%

```typescript
function calculatePartTimeSupplementaryPremium(
  salaryAmount: number,
  basicWage: number = 27470
): SupplementaryPremiumResult {
  if (salaryAmount < basicWage) {
    return { premiumAmount: 0 }; // 未達門檻，免扣
  }
  
  return {
    premiumAmount: Math.round(salaryAmount * 0.0211)
  };
}
```

## 數據庫結構

### 員工年度獎金累計表 (EmployeeAnnualBonus)
```sql
CREATE TABLE employee_annual_bonus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  total_bonus_amount REAL DEFAULT 0,      -- 年度累計獎金
  supplementary_premium REAL DEFAULT 0,   -- 年度累計補充保費
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(employee_id, year),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

### 獎金記錄表 (BonusRecord)
```sql
CREATE TABLE bonus_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  annual_bonus_id INTEGER NOT NULL,
  bonus_type VARCHAR(50) NOT NULL,        -- 獎金類型
  bonus_type_name VARCHAR(100) NOT NULL,  -- 獎金類型顯示名稱
  amount REAL NOT NULL,                   -- 獎金金額
  payroll_year INTEGER NOT NULL,
  payroll_month INTEGER NOT NULL,
  
  -- 補充保費計算資訊
  insured_amount REAL NOT NULL,           -- 投保金額
  exempt_threshold REAL NOT NULL,         -- 免扣門檻
  cumulative_bonus_before REAL NOT NULL,  -- 發放前累計
  cumulative_bonus_after REAL NOT NULL,   -- 發放後累計
  calculation_base REAL DEFAULT 0,        -- 計費基數
  supplementary_premium REAL DEFAULT 0,   -- 補充保費
  premium_rate REAL DEFAULT 0.0211,       -- 費率
  
  is_adjustment BOOLEAN DEFAULT FALSE,     -- 是否為調整記錄
  adjustment_reason TEXT,                  -- 調整原因
  original_record_id INTEGER,             -- 原始記錄ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER NOT NULL,
  
  UNIQUE(employee_id, bonus_type, payroll_year, payroll_month, is_adjustment),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (annual_bonus_id) REFERENCES employee_annual_bonus(id),
  FOREIGN KEY (original_record_id) REFERENCES bonus_records(id)
);
```

### 獎金配置表 (BonusConfiguration)
```sql
CREATE TABLE bonus_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bonus_type VARCHAR(50) UNIQUE NOT NULL,
  bonus_type_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  default_amount REAL,
  calculation_formula TEXT,
  eligibility_rules JSON,           -- 發放資格規則
  payment_schedule JSON,            -- 發放時程規則
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API 端點

### 獎金管理 API

#### GET /api/bonuses
查詢獎金記錄
```typescript
interface QueryParams {
  employeeId?: string;
  year?: string;
  month?: string;
  bonusType?: string;
}

interface Response {
  success: boolean;
  data: {
    records: BonusRecord[];
    annualSummary?: AnnualSummary;
  };
}
```

#### POST /api/bonuses
新增獎金記錄
```typescript
interface RequestBody {
  employeeId: number;
  bonusType: string;
  bonusTypeName: string;
  amount: number;
  payrollYear: number;
  payrollMonth: number;
  createdBy: number;
}

interface Response {
  success: boolean;
  data: BonusRecord;
  supplementaryCalculation: BonusSupplementaryCalculation;
}
```

#### PUT /api/bonuses
更新獎金記錄
```typescript
interface RequestBody {
  id: number;
  amount: number;
  adjustmentReason?: string;
  createdBy: number;
}
```

#### DELETE /api/bonuses
刪除獎金記錄
```typescript
interface QueryParams {
  id: string;
}
```

## 業務規則

### 1. 年度邊界處理
- 獎金累計以「年度」為單位重新計算
- 跨年度獎金各自獨立計算免扣門檻

### 2. 調整記錄處理
- 支援獎金金額調整
- 自動重新計算補充保費
- 保持歷史記錄完整性

### 3. 計費上限
- 單次獎金計費基礎最高1,000萬元
- 超過上限部分不計算補充保費

### 4. 四捨五入規則
- 補充保費金額四捨五入至整數
- 計算過程保留小數精度

## 薪資條整合

### 薪資條結構更新
```typescript
interface PayslipStructure {
  earnings: {
    baseSalary: number;
    overtime: number;
    yearEndBonus?: number;      // 年終獎金
    festivalBonus?: number;     // 三節獎金
    performanceBonus?: number;  // 績效獎金
    totalEarnings: number;
  };
  
  deductions: {
    laborInsurance: number;
    healthInsurance: number;
    supplementaryInsurance: number;  // 包含薪資+獎金補充保費
    incomeTax: number;
    totalDeductions: number;
  };
  
  netPay: number;
  
  // 補充保費明細
  supplementaryDetails: {
    salaryPremium: number;        // 薪資補充保費
    bonusPremium: number;         // 獎金補充保費
    calculationDetails: BonusSupplementaryCalculation[];
  };
}
```

### 薪資計算整合
```typescript
// 在薪資計算時整合獎金補充保費
const calculatePayroll = async (employeeId: number, year: number, month: number) => {
  // 1. 計算基本薪資
  const baseSalary = await calculateBaseSalary(employeeId, year, month);
  
  // 2. 查詢該月份獎金補充保費
  const bonusRecords = await getBonusRecords(employeeId, year, month);
  const bonusSupplementaryPremium = bonusRecords.reduce(
    (sum, record) => sum + record.supplementaryPremium, 
    0
  );
  
  // 3. 計算總扣除額 (包含獎金補充保費)
  const totalDeductions = calculateAllDeductions(
    baseSalary.grossPay,
    baseSalary.annualSalary,
    employee.dependentsCount,
    bonusSupplementaryPremium
  );
  
  return {
    ...baseSalary,
    deductions: totalDeductions,
    bonusSupplementaryPremium
  };
};
```

## 合規性與稽核

### 1. 法規遵循
- 依據全民健康保險法施行細則
- 配合費率異動及時更新
- 保持計算邏輯與政府規定一致

### 2. 稽核記錄
- 完整記錄所有計算過程
- 支援歷史資料查詢
- 提供計算邏輯追蹤

### 3. 錯誤處理
- 驗證輸入資料完整性
- 處理異常情況 (如負數獎金)
- 提供明確的錯誤訊息

## 維護與監控

### 1. 費率更新
```typescript
// 系統支援費率動態配置
interface SupplementaryRate {
  rate: number;           // 費率
  effectiveDate: Date;    // 生效日期
  isActive: boolean;      // 是否啟用
}
```

### 2. 計算驗證
```typescript
// 提供計算驗證工具
const validateSupplementaryCalculation = (
  calculation: BonusSupplementaryCalculation
) => {
  // 驗證計算邏輯正確性
  // 檢查數值合理性
  // 確認法規遵循性
};
```

### 3. 報表支援
- 提供月度補充保費報表
- 支援年度統計分析
- 匯出功能支援會計作業

## 技術考量

### 1. 效能優化
- 年度累計資料緩存
- 批量計算支援
- 數據庫索引優化

### 2. 資料一致性
- 使用事務確保資料完整性
- 支援並發操作
- 提供資料備份機制

### 3. 可擴展性
- 模組化設計支援新增收入類型
- 配置化規則支援政策調整
- API設計支援第三方整合

---

## 更新日誌

- **v1.0.0** (2024-09-05): 初始版本，支援獎金補充保費計算
- 費率更新至2.11% (2024年標準)
- 完整的獎金管理功能
- 薪資條結構整合
