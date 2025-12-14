# 請假類型與給薪關係說明書

## 📋 概述

本文檔詳細說明本公司所有請假類型的給薪規則、申請條件、法源依據及相關注意事項，作為員工申請請假和HR審核的重要參考資料。

## 🏢 請假類型總覽

| 請假類型 | 代碼 | 給薪狀況 | 年度上限 | 法源依據 |
|---------|------|---------|---------|----------|
| 特休假 | ANNUAL | ✅ 給薪 | 依年資計算 | 勞基法第38條 |
| 病假 | SICK | 🔄 部分給薪 | 30天 | 勞基法第43條 |
| 事假 | PERSONAL | ❌ 不給薪 | 14天 | 勞基法第43條 |
| 產假 | MATERNITY | ✅ 給薪 | 8週 | 勞基法第50條 |
| 陪產假 | PATERNITY | ✅ 給薪 | 5天 | 性平法第15條 |
| 喪假 | BEREAVEMENT | ✅ 給薪 | 依親等計算 | 勞工請假規則第3條 |
| 補休 | COMPENSATORY | ✅ 給薪 | 無上限 | 內部規定 |
| 生理假 | MENSTRUAL | 🔄 部分給薪 | 12個月內3天 | 性平法第14條 |
| 公假 | OFFICIAL | ✅ 給薪 | 無上限 | 內部規定 |
| 家庭照顧假 | FAMILY_CARE | ❌ 不給薪 | 7天 | 性平法第20條 |

---

## 📝 各類請假詳細說明

### 1. 特休假 (ANNUAL)
**🟢 給薪假別**

#### 基本規定
- **給薪方式**: 100% 原薪給付
- **年度天數**: 依年資計算
  - 滿6個月: 3天
  - 滿1年: 7天
  - 滿2年: 10天
  - 滿3年: 14天
  - 滿5年: 15天
  - 滿10年: 每年加1天，最高30天
- **申請方式**: 事前申請，建議提前3天
- **法源依據**: 勞動基準法第38條

#### 薪資計算
```typescript
// 特休假薪資計算
const annualLeavePay = {
  dailyPay: baseSalary / workingDaysInMonth,
  paymentRate: 1.0, // 100% 給薪
  isPaid: true,
  deductFromSalary: false
};
```

#### 注意事項
- 未休完之特休假，雇主應發給工資
- 不得因請特休假而扣發全勤獎金
- 可分次申請，無最小單位限制

---

### 2. 病假 (SICK)
**🟡 部分給薪假別**

#### 基本規定
- **給薪方式**: 一年內未超過30天者，工資折半發給
- **年度上限**: 30天
- **申請條件**: 因疾病必須治療或療養
- **證明文件**: 需檢附醫院證明書
- **法源依據**: 勞動基準法第43條

#### 薪資計算
```typescript
// 病假薪資計算
const sickLeavePay = {
  dailyPay: (baseSalary / workingDaysInMonth) * 0.5,
  paymentRate: 0.5, // 50% 給薪
  isPaid: true,
  partialPay: true,
  annualLimit: 30 // 天
};

// 超過30天後不給薪
if (sickDaysInYear > 30) {
  return {
    dailyPay: 0,
    paymentRate: 0,
    isPaid: false
  };
}
```

#### 注意事項
- 住院病假連續請假獲准者，其超過限度之日數，視為事假
- 職業災害引起之疾病或傷害，其治療、休養期間給予公傷病假
- 慢性疾病需定期治療者，可申請定期病假

---

### 3. 事假 (PERSONAL)
**🔴 不給薪假別**

#### 基本規定
- **給薪方式**: 不給薪
- **年度上限**: 14天
- **申請條件**: 因有事故必須親自處理
- **申請方式**: 事前申請，緊急情況可事後補辦
- **法源依據**: 勞動基準法第43條

#### 薪資計算
```typescript
// 事假薪資計算
const personalLeavePay = {
  dailyPay: 0,
  paymentRate: 0, // 0% 給薪
  isPaid: false,
  deductFromSalary: true,
  annualLimit: 14 // 天
};

// 薪資扣除計算
const salaryDeduction = (baseSalary / workingDaysInMonth) * personalLeaveDays;
```

#### 注意事項
- 超過14天限度者，事業單位得不准假
- 不得連續請假超過相當期間
- 影響工作進度時，雇主可要求調整請假時間

---

### 4. 產假 (MATERNITY)
**🟢 給薪假別**

#### 基本規定
- **給薪方式**: 100% 原薪給付
- **假期長度**: 8週（56天）
- **申請條件**: 分娩前後
- **申請方式**: 產前可預先申請，產後立即生效
- **法源依據**: 勞動基準法第50條

#### 薪資計算
```typescript
// 產假薪資計算
const maternityLeavePay = {
  totalDays: 56,
  dailyPay: baseSalary / 30, // 以月薪計算
  paymentRate: 1.0, // 100% 給薪
  isPaid: true,
  additionalBenefits: {
    laborInsurance: true, // 勞保生育給付
    nationalInsurance: true // 國民年金生育給付
  }
};
```

#### 注意事項
- 產假期間不得要求勞工工作
- 可申請勞保生育給付
- 產假結束後，雇主應協助復職

---

### 5. 陪產假 (PATERNITY)
**🟢 給薪假別**

#### 基本規定
- **給薪方式**: 100% 原薪給付
- **假期長度**: 5天
- **申請條件**: 配偶分娩時
- **請假期間**: 配偶分娩前後合計15日期間內
- **法源依據**: 性別工作平等法第15條

#### 薪資計算
```typescript
// 陪產假薪資計算
const paternityLeavePay = {
  totalDays: 5,
  dailyPay: baseSalary / workingDaysInMonth,
  paymentRate: 1.0, // 100% 給薪
  isPaid: true,
  flexibleScheduling: true // 可彈性安排
};
```

#### 注意事項
- 可分次申請，但需於15日期間內請完
- 需檢附配偶分娩證明文件
- 不得因請陪產假而為不利處分

---

### 6. 喪假 (BEREAVEMENT)
**🟢 給薪假別**

#### 基本規定
- **給薪方式**: 100% 原薪給付
- **假期長度**: 依親等關係計算
  - 父母、養父母、繼父母、配偶：8天
  - 祖父母、子女、配偶之父母：6天  
  - 曾祖父母、兄弟姊妹、配偶之祖父母：3天
- **法源依據**: 勞工請假規則第3條

#### 薪資計算
```typescript
// 喪假薪資計算
const bereavementLeaveDays = {
  'parents': 8,           // 父母
  'spouse': 8,            // 配偶
  'grandparents': 6,      // 祖父母
  'children': 6,          // 子女
  'siblings': 3           // 兄弟姊妹
};

const bereavementLeavePay = {
  dailyPay: baseSalary / workingDaysInMonth,
  paymentRate: 1.0, // 100% 給薪
  isPaid: true
};
```

#### 注意事項
- 需檢附死亡證明書或訃聞
- 應於百日內請畢
- 可分次申請，但以合理為限

---

### 7. 補休 (COMPENSATORY)
**🟢 給薪假別**

#### 基本規定
- **給薪方式**: 視為正常工作時間給薪
- **申請條件**: 因加班而累積之補休時數
- **有效期限**: 通常為6個月至1年
- **法源依據**: 勞動基準法第32條之1

#### 薪資計算
```typescript
// 補休薪資計算
const compensatoryLeavePay = {
  hourlyPay: baseSalary / (workingDaysInMonth * 8),
  paymentRate: 1.0, // 100% 給薪
  isPaid: true,
  source: 'overtime_compensation' // 來源為加班補償
};
```

#### 注意事項
- 應優先使用，避免過期失效
- 不可強迫勞工一定要補休
- 補休未休完應發給加班費

---

### 8. 生理假 (MENSTRUAL)
**🟡 部分給薪假別**

#### 基本規定
- **給薪方式**: 
  - 每月1天：減半給薪
  - 其餘日數：併入病假計算
- **年度上限**: 12個月內3天（不併入病假日數計算）
- **申請條件**: 女性員工生理期間
- **法源依據**: 性別工作平等法第14條

#### 薪資計算
```typescript
// 生理假薪資計算
const menstrualLeavePay = {
  monthlyPaidDay: 1, // 每月1天減半給薪
  dailyPay: (baseSalary / workingDaysInMonth) * 0.5,
  paymentRate: 0.5, // 50% 給薪
  additionalDays: 'treated_as_sick_leave', // 超過部分併入病假
  annualLimit: 3 // 天（12個月內）
};
```

#### 注意事項
- 不需檢附證明文件
- 不得因請生理假而為不利處分
- 超過每月1天者，併入病假計算

---

### 9. 公假 (OFFICIAL)
**🟢 給薪假別**

#### 基本規定
- **給薪方式**: 100% 原薪給付
- **申請條件**: 
  - 依法令規定應給予之假（如兵役、選舉、作證等）
  - 公司指派之公務出差、訓練
- **法源依據**: 各相關法令規定

#### 薪資計算
```typescript
// 公假薪資計算
const officialLeavePay = {
  dailyPay: baseSalary / workingDaysInMonth,
  paymentRate: 1.0, // 100% 給薪
  isPaid: true,
  types: [
    'military_service',    // 兵役
    'jury_duty',          // 作證
    'election_duty',      // 選舉事務
    'business_trip',      // 公務出差
    'training'            // 教育訓練
  ]
};
```

#### 注意事項
- 需檢附相關證明文件
- 公務出差需事前申請核准
- 不影響全勤及考核

---

### 10. 家庭照顧假 (FAMILY_CARE)
**🔴 不給薪假別**

#### 基本規定
- **給薪方式**: 不給薪
- **年度上限**: 7天
- **申請條件**: 家庭成員預防接種、發生嚴重之疾病或其他重大事故須親自照顧時
- **法源依據**: 性別工作平等法第20條

#### 薪資計算
```typescript
// 家庭照顧假薪資計算
const familyCareLeavePay = {
  dailyPay: 0,
  paymentRate: 0, // 0% 給薪
  isPaid: false,
  deductFromSalary: true,
  annualLimit: 7, // 天
  applicableFamily: [
    'spouse',           // 配偶
    'children',         // 子女  
    'parents',          // 父母
    'spouse_parents'    // 配偶父母
  ]
};

// 薪資扣除計算
const salaryDeduction = (baseSalary / workingDaysInMonth) * familyCareDays;
```

#### 注意事項
- 併入事假日數計算
- 不得因請家庭照顧假而為不利處分
- 雇主得要求提供相關證明文件

---

## 💰 薪資計算範例

### 基本薪資資訊
```typescript
const employeeSalary = {
  baseSalary: 50000,        // 月薪
  workingDays: 22,          // 當月工作日
  dailySalary: 2273         // 日薪 (50000/22)
};
```

### 各類請假薪資範例（請假2天）

| 請假類型 | 計算方式 | 實發薪資 | 扣除金額 |
|---------|---------|---------|---------|
| 特休假 | 50,000 - 0 | 50,000 | 0 |
| 病假 | 50,000 - (2,273 × 2 × 0.5) | 47,727 | 2,273 |
| 事假 | 50,000 - (2,273 × 2) | 45,454 | 4,546 |
| 產假 | 50,000 - 0 | 50,000 | 0 |
| 陪產假 | 50,000 - 0 | 50,000 | 0 |
| 喪假 | 50,000 - 0 | 50,000 | 0 |
| 補休 | 50,000 - 0 | 50,000 | 0 |
| 生理假 | 50,000 - (2,273 × 2 × 0.5) | 47,727 | 2,273 |
| 公假 | 50,000 - 0 | 50,000 | 0 |
| 家庭照顧假 | 50,000 - (2,273 × 2) | 45,454 | 4,546 |

---

## 📊 請假統計與報表

### 年度請假天數統計表
```sql
-- 各類請假使用統計
SELECT 
  e.employeeId,
  e.name,
  lr.leaveType,
  COUNT(*) as request_count,
  SUM(lr.totalDays) as total_days,
  CASE lr.leaveType
    WHEN 'ANNUAL' THEN SUM(lr.totalDays * (baseSalary/22))
    WHEN 'SICK' THEN SUM(lr.totalDays * (baseSalary/22) * 0.5)
    WHEN 'PERSONAL' THEN 0
    WHEN 'FAMILY_CARE' THEN 0
    ELSE SUM(lr.totalDays * (baseSalary/22))
  END as paid_amount
FROM employees e
LEFT JOIN leave_requests lr ON e.id = lr.employeeId
WHERE lr.status = 'APPROVED'
  AND YEAR(lr.startDate) = 2024
GROUP BY e.id, lr.leaveType
ORDER BY e.employeeId, lr.leaveType;
```

### 薪資成本影響分析
```typescript
// 請假對公司薪資成本的影響計算
interface LeaveCostAnalysis {
  paidLeaves: {
    annual: number;      // 特休假成本
    sick: number;        // 病假成本（50%）
    maternity: number;   // 產假成本
    paternity: number;   // 陪產假成本
    bereavement: number; // 喪假成本
    official: number;    // 公假成本
    menstrual: number;   // 生理假成本（50%）
  };
  unpaidLeaves: {
    personal: number;     // 事假節省成本
    familyCare: number;   // 家庭照顧假節省成本
  };
  totalCost: number;      // 總成本影響
}
```

---

## ⚖️ 法規遵循檢查清單

### 雇主義務檢查
- [ ] 是否正確給付各類有薪假別薪資
- [ ] 是否依法給予法定假別天數
- [ ] 是否因員工請假而為不利處分
- [ ] 是否要求不當之證明文件
- [ ] 是否正確計算並給付未休特休假工資

### 員工權益檢查  
- [ ] 是否了解各類請假給薪規則
- [ ] 是否在規定期限內申請請假
- [ ] 是否檢附必要證明文件
- [ ] 是否合理安排工作交接
- [ ] 是否濫用請假規定

---

## 🔧 系統設定建議

### 薪資系統整合
```typescript
// 請假薪資計算設定
const leavePayrollSettings = {
  ANNUAL: { payRate: 1.0, deductible: false },
  SICK: { payRate: 0.5, deductible: false, limit: 30 },
  PERSONAL: { payRate: 0.0, deductible: true, limit: 14 },
  MATERNITY: { payRate: 1.0, deductible: false },
  PATERNITY: { payRate: 1.0, deductible: false },
  BEREAVEMENT: { payRate: 1.0, deductible: false },
  COMPENSATORY: { payRate: 1.0, deductible: false },
  MENSTRUAL: { payRate: 0.5, deductible: false, limit: 3 },
  OFFICIAL: { payRate: 1.0, deductible: false },
  FAMILY_CARE: { payRate: 0.0, deductible: true, limit: 7 }
};
```

### 自動化提醒設定
- 特休假到期提醒（未休假提醒）
- 請假額度不足警告
- 薪資扣除確認通知
- 法定假別權益說明

---

## 📞 聯絡資訊

**人資部門**
- 📧 Email: hr@company.com
- 📱 分機: 101-102
- 🕐 服務時間: 週一至週五 09:00-18:00

**相關法規查詢**
- 勞動部官網: https://www.mol.gov.tw/
- 勞工請假規則: 查詢最新版本
- 性別工作平等法: 查詢最新條文

---

*最後更新時間: 2025年9月6日*
*版本: v2.0*
*負責單位: 人力資源部*
