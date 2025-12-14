# 薪資條結構與數據庫設計文檔

## 文檔概述

本文檔詳細說明長富考勤系統的薪資條結構設計、數據庫模型、健保費計算邏輯以及相關配置管理。系統支援完整的薪資計算，包含健保費（含眷屬人數）、勞保費、補充保費、所得稅等所有法定扣除項目。

**更新日期**: 2025年9月4日
**版本**: 2.0
**適用範圍**: 台灣勞工保險及健保制度

## 薪資條結構設計

### 基本薪資結構

```typescript
interface PayrollStructure {
  // 薪資收入項目
  earnings: {
    baseSalary: number;           // 基本薪資
    overtimePay: number;          // 加班費
    bonus: number;                // 績效獎金
    allowances: number;           // 各項津貼
    grossPay: number;             // 薪資總額
  };
  
  // 法定扣除項目
  deductions: {
    laborInsurance: number;       // 勞保費
    healthInsurance: number;      // 健保費
    supplementaryInsurance: number; // 補充保費
    incomeTax: number;           // 所得稅
    totalDeductions: number;      // 扣除總額
  };
  
  // 淨薪資
  netPay: number;                 // 實領薪資
  
  // 詳細計算資訊
  calculationDetails: {
    healthInsuranceDetails: HealthInsuranceCalculation;
    workingHours: HoursBreakdown;
    taxCalculation: TaxBreakdown;
  };
}
```

### 健保費計算結構

```typescript
interface HealthInsuranceCalculation {
  insuredAmount: number;          // 投保金額
  dependentsCount: number;        // 申報眷屬人數
  actualDependents: number;       // 實際計費眷屬人數 (最多3位)
  totalInsuredPersons: number;    // 總計費人數 (本人+眷屬)
  premiumRate: number;            // 保險費率 (5.17%)
  employeeRatio: number;          // 員工負擔比例 (30%)
  individualPremium: number;      // 個人單月保費
  totalPremium: number;           // 總健保費
  calculation: string;            // 計算公式說明
}
```

## 數據庫設計

### 員工基本資料表 (Employee)

```sql
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  birthday DATETIME NOT NULL,
  phone TEXT,
  address TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  hire_date DATETIME NOT NULL,
  base_salary REAL NOT NULL,
  hourly_rate REAL NOT NULL,
  department TEXT,
  position TEXT,
  is_active BOOLEAN DEFAULT 1,
  
  -- 健保相關欄位
  insured_base REAL,                    -- 投保薪資基數
  dependents_count INTEGER DEFAULT 0,   -- 健保眷屬人數
  health_insurance_active BOOLEAN DEFAULT 1,
  health_insurance_start_date DATETIME,
  health_insurance_end_date DATETIME,
  
  -- 勞退相關
  labor_pension_self_rate REAL,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 薪資記錄表 (PayrollRecord)

```sql
CREATE TABLE payroll_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  pay_year INTEGER NOT NULL,
  pay_month INTEGER NOT NULL,
  
  -- 工時資訊
  regular_hours REAL NOT NULL,
  overtime_hours REAL NOT NULL,
  
  -- 薪資項目
  base_pay REAL NOT NULL,
  overtime_pay REAL NOT NULL,
  gross_pay REAL NOT NULL,
  
  -- 扣除項目
  labor_insurance REAL DEFAULT 0,
  health_insurance REAL DEFAULT 0,
  supplementary_insurance REAL DEFAULT 0,
  income_tax REAL DEFAULT 0,
  total_deductions REAL DEFAULT 0,
  
  -- 實領薪資
  net_pay REAL NOT NULL,
  
  -- 健保計算詳情
  health_insurance_details TEXT, -- JSON格式存儲
  dependents_count_used INTEGER DEFAULT 0,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE(employee_id, pay_year, pay_month)
);
```

### 健保費配置表 (HealthInsuranceConfig)

```sql
CREATE TABLE health_insurance_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  premium_rate REAL DEFAULT 0.0517,              -- 保險費率
  employee_contribution_ratio REAL DEFAULT 0.30, -- 員工負擔比例
  max_dependents INTEGER DEFAULT 3,              -- 最大眷屬人數
  supplementary_rate REAL DEFAULT 0.0217,        -- 補充保費費率
  supplementary_threshold REAL DEFAULT 744000,   -- 補充保費門檻
  effective_date DATETIME NOT NULL,              -- 生效日期
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 健保投保金額分級表 (HealthInsuranceSalaryLevel)

```sql
CREATE TABLE health_insurance_salary_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id INTEGER NOT NULL,
  min_salary REAL NOT NULL,     -- 月薪下限
  max_salary REAL NOT NULL,     -- 月薪上限
  insured_amount REAL NOT NULL, -- 對應投保金額
  level INTEGER NOT NULL,       -- 級距序號
  
  FOREIGN KEY (config_id) REFERENCES health_insurance_configs(id)
);
```

## 薪資計算流程

### 1. 數據收集階段

```typescript
// 收集員工基本資料
const employee = await prisma.employee.findUnique({
  where: { id: employeeId },
  select: {
    baseSalary: true,
    hourlyRate: true,
    dependentsCount: true,
    healthInsuranceActive: true
  }
});

// 收集當月工時記錄
const attendanceRecords = await prisma.attendanceRecord.findMany({
  where: {
    employeeId: employeeId,
    workDate: {
      gte: startOfMonth,
      lte: endOfMonth
    }
  }
});
```

### 2. 工時統計階段

```typescript
// 計算總工時和加班時數
const workingHours = {
  regularHours: attendanceRecords.reduce((sum, record) => 
    sum + (record.regularHours || 0), 0),
  overtimeHours: attendanceRecords.reduce((sum, record) => 
    sum + (record.overtimeHours || 0), 0)
};
```

### 3. 薪資計算階段

```typescript
// 計算基本薪資和加班費
const earnings = {
  basePay: employee.baseSalary,
  overtimePay: workingHours.overtimeHours * employee.hourlyRate * 1.34, // 加班費率1.34倍
  grossPay: basePay + overtimePay
};
```

### 4. 扣除項目計算

```typescript
// 使用健保費計算函數
const deductions = calculateAllDeductions(
  earnings.grossPay,
  earnings.grossPay * 12, // 年薪
  employee.dependentsCount // 眷屬人數
);
```

### 5. 薪資記錄儲存

```typescript
// 建立薪資記錄
const payrollRecord = await prisma.payrollRecord.create({
  data: {
    employeeId: employee.id,
    payYear: year,
    payMonth: month,
    regularHours: workingHours.regularHours,
    overtimeHours: workingHours.overtimeHours,
    basePay: earnings.basePay,
    overtimePay: earnings.overtimePay,
    grossPay: earnings.grossPay,
    laborInsurance: deductions.laborInsurance,
    healthInsurance: deductions.healthInsurance,
    supplementaryInsurance: deductions.supplementaryHealthInsurance,
    incomeTax: deductions.incomeTax,
    totalDeductions: deductions.totalDeductions,
    netPay: deductions.netSalary,
    healthInsuranceDetails: JSON.stringify(deductions.healthInsuranceDetails),
    dependentsCountUsed: deductions.healthInsuranceDetails.actualDependents
  }
});
```

## API端點設計

### 薪資計算API

#### POST `/api/payroll/calculate`
計算指定員工的月薪資

**請求參數**:
```json
{
  "employeeId": 1,
  "year": 2025,
  "month": 9,
  "overrideData": {
    "dependentsCount": 2,
    "baseSalary": 50000
  }
}
```

**回應格式**:
```json
{
  "success": true,
  "data": {
    "employee": {
      "id": 1,
      "name": "王小明",
      "employeeId": "EMP001"
    },
    "period": {
      "year": 2025,
      "month": 9
    },
    "earnings": {
      "basePay": 50000,
      "overtimePay": 3350,
      "grossPay": 53350
    },
    "deductions": {
      "laborInsurance": 1067,
      "healthInsurance": 1570,
      "supplementaryInsurance": 0,
      "incomeTax": 1200,
      "totalDeductions": 3837
    },
    "netPay": 49513,
    "calculationDetails": {
      "healthInsuranceDetails": {
        "insuredAmount": 53000,
        "dependentsCount": 2,
        "actualDependents": 2,
        "totalInsuredPersons": 3,
        "premiumRate": 0.0517,
        "employeeRatio": 0.30,
        "individualPremium": 823,
        "totalPremium": 1570,
        "calculation": "53000 × 5.17% × 30% × 3 = 1570"
      }
    }
  }
}
```

### 健保費設定API

#### GET `/api/payroll/health-insurance/config`
取得當前健保費配置

#### PUT `/api/payroll/health-insurance/config`
更新健保費配置

**請求參數**:
```json
{
  "premiumRate": 0.0517,
  "employeeContributionRatio": 0.30,
  "maxDependents": 3,
  "supplementaryRate": 0.0217,
  "supplementaryThreshold": 744000,
  "effectiveDate": "2025-01-01T00:00:00Z"
}
```

### 員工眷屬管理API

#### PUT `/api/employees/{id}/dependents`
更新員工健保眷屬人數

**請求參數**:
```json
{
  "dependentsCount": 2,
  "effectiveDate": "2025-09-01T00:00:00Z"
}
```

## 權限控制

### 角色權限矩陣

| 功能 | EMPLOYEE | HR | ADMIN |
|------|----------|----| ------|
| 查看自己薪資條 | ✅ | ❌ | ✅ |
| 查看所有員工薪資 | ❌ | ✅ | ✅ |
| 計算薪資 | ❌ | ✅ | ✅ |
| 更新健保設定 | ❌ | ❌ | ✅ |
| 管理員工眷屬 | ❌ | ✅ | ✅ |

## 資料驗證規則

### 員工資料驗證

```typescript
const employeeValidation = z.object({
  dependentsCount: z.number()
    .min(0, '眷屬人數不能為負數')
    .max(10, '眷屬人數不能超過10人')
    .int('眷屬人數必須為整數'),
  baseSalary: z.number()
    .min(25200, '基本薪資不能低於基本工資')
    .max(1000000, '基本薪資不能超過100萬'),
  healthInsuranceActive: z.boolean()
});
```

### 薪資計算驗證

```typescript
const payrollValidation = z.object({
  year: z.number().min(2020).max(2030),
  month: z.number().min(1).max(12),
  employeeId: z.number().positive(),
  overrideData: z.object({
    dependentsCount: z.number().min(0).max(10).optional(),
    baseSalary: z.number().positive().optional()
  }).optional()
});
```

## 錯誤處理

### 常見錯誤類型

1. **員工不存在**
   - 錯誤碼: `EMPLOYEE_NOT_FOUND`
   - HTTP狀態: 404
   - 訊息: "指定的員工不存在"

2. **薪資記錄重複**
   - 錯誤碼: `PAYROLL_DUPLICATE`
   - HTTP狀態: 409
   - 訊息: "該員工該月份的薪資記錄已存在"

3. **投保金額查找失敗**
   - 錯誤碼: `INSURED_AMOUNT_NOT_FOUND`
   - HTTP狀態: 500
   - 訊息: "無法找到對應的投保金額級距"

4. **健保配置缺失**
   - 錯誤碼: `HEALTH_CONFIG_MISSING`
   - HTTP狀態: 500
   - 訊息: "健保費配置不存在或已失效"

## 性能優化建議

### 數據庫優化

1. **索引設計**
   ```sql
   -- 薪資記錄查詢索引
   CREATE INDEX idx_payroll_employee_period ON payroll_records(employee_id, pay_year, pay_month);
   
   -- 健保分級表查詢索引
   CREATE INDEX idx_salary_level_range ON health_insurance_salary_levels(min_salary, max_salary);
   
   -- 員工眷屬查詢索引
   CREATE INDEX idx_employee_dependents ON employees(dependents_count, health_insurance_active);
   ```

2. **查詢優化**
   - 使用批量查詢減少數據庫往返
   - 實施適當的分頁機制
   - 緩存健保費配置數據

### 緩存策略

```typescript
// 健保配置緩存
const healthConfigCache = new Map<string, HealthInsuranceConfig>();

export async function getCachedHealthConfig(): Promise<HealthInsuranceConfig> {
  const cacheKey = 'current_health_config';
  
  if (!healthConfigCache.has(cacheKey)) {
    const config = await prisma.healthInsuranceConfig.findFirst({
      where: { isActive: true },
      orderBy: { effectiveDate: 'desc' }
    });
    
    if (config) {
      healthConfigCache.set(cacheKey, config);
      // 設定1小時後過期
      setTimeout(() => healthConfigCache.delete(cacheKey), 3600000);
    }
  }
  
  return healthConfigCache.get(cacheKey);
}
```

## 審計與日誌

### 薪資計算日誌

```typescript
interface PayrollCalculationLog {
  employeeId: number;
  calculationDate: Date;
  period: { year: number; month: number };
  inputData: any;
  outputData: any;
  calculationTime: number; // 毫秒
  operator: string; // 操作者
  ipAddress: string;
}
```

### 眷屬變更日誌

```typescript
interface DependentsChangeLog {
  employeeId: number;
  oldCount: number;
  newCount: number;
  effectiveDate: Date;
  changeReason: string;
  operator: string;
  timestamp: Date;
}
```

## 測試策略

### 單元測試範例

```typescript
describe('健保費計算測試', () => {
  test('無眷屬員工健保費計算', () => {
    const result = calculateHealthInsurance(50000, 0);
    expect(result.totalInsuredPersons).toBe(1);
    expect(result.actualDependents).toBe(0);
    expect(result.totalPremium).toBe(785); // 預期值
  });

  test('3位眷屬員工健保費計算', () => {
    const result = calculateHealthInsurance(50000, 3);
    expect(result.totalInsuredPersons).toBe(4);
    expect(result.actualDependents).toBe(3);
    expect(result.totalPremium).toBe(3140); // 預期值
  });

  test('超過3位眷屬的上限測試', () => {
    const result = calculateHealthInsurance(50000, 5);
    expect(result.totalInsuredPersons).toBe(4);
    expect(result.actualDependents).toBe(3); // 最多3位
  });
});
```

### 整合測試

```typescript
describe('薪資條生成整合測試', () => {
  test('完整薪資條生成流程', async () => {
    // 1. 準備測試數據
    const employee = await createTestEmployee({
      baseSalary: 50000,
      dependentsCount: 2
    });

    // 2. 建立考勤記錄
    await createTestAttendanceRecords(employee.id, {
      regularHours: 160,
      overtimeHours: 10
    });

    // 3. 計算薪資
    const result = await calculatePayroll(employee.id, 2025, 9);

    // 4. 驗證結果
    expect(result.success).toBe(true);
    expect(result.data.netPay).toBeGreaterThan(0);
    expect(result.data.deductions.healthInsurance).toBe(1570);
  });
});
```

## 維護指南

### 定期維護任務

1. **每月任務**
   - 檢查健保費率是否有更新
   - 驗證投保金額分級表的正確性
   - 清理過期的計算緩存

2. **每季任務**
   - 審查薪資計算準確性
   - 更新所得稅扣繳標準
   - 備份重要配置數據

3. **每年任務**
   - 更新勞保、健保費率
   - 更新所得稅免稅額和扣除額
   - 更新基本工資標準

### 配置更新流程

1. **準備階段**
   - 收集最新法規資訊
   - 準備新的配置數據
   - 通知相關人員

2. **測試階段**
   - 在測試環境驗證新配置
   - 進行計算結果比對
   - 確認數據完整性

3. **部署階段**
   - 備份現有配置
   - 部署新配置
   - 驗證部署結果

4. **監控階段**
   - 監控計算結果異常
   - 收集用戶反饋
   - 必要時進行微調

---

*本文檔涵蓋了完整的薪資條結構設計和數據庫實施方案，支援台灣勞健保制度的所有要求。建議定期檢查法規變更並更新相關配置。*

**文檔維護**:
- **版本**: 2.0
- **最後更新**: 2025年9月4日
- **維護負責人**: 系統開發團隊
- **審核週期**: 每季度
