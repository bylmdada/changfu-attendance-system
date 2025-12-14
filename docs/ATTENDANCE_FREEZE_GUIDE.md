# 考勤凍結管理系統

## 概述

考勤凍結管理系統是長福會考勤系統的重要功能模組，允許管理員設定特定的日期和時間，在此之後員工無法為指定的月份提交請假、加班、調班等考勤申請。這個功能主要用於月結期間、年度結算、系統維護等關鍵時期，確保考勤數據的完整性和準確性。

## 功能特點

### 1. 靈活的凍結設定
- **精確時間控制**: 可以設定到分鐘級別的凍結時間點
- **月份鎖定**: 指定凍結哪些年份的哪些月份
- **批量凍結**: 可以為多個月份設定相同的凍結時間
- **即時生效**: 一旦設定立即生效，無需重啟系統

### 2. 全面的申請限制
- **請假申請**: 凍結期間無法提交請假申請
- **加班申請**: 凍結期間無法提交加班申請
- **調班申請**: 凍結期間無法提交調班申請
- **班表修改**: 凍結期間無法修改個人班表

### 3. 權限控制
- **管理員權限**: 只有管理員可以設定凍結
- **HR查看權限**: HR可以查看凍結設定但不能修改
- **員工透明**: 員工在嘗試申請時會收到清晰的凍結提示

## 系統架構

### 數據庫設計

#### AttendanceFreeze 表
```sql
CREATE TABLE attendance_freezes (
  id INT PRIMARY KEY AUTOINCREMENT,
  freeze_date DATETIME NOT NULL,           -- 凍結日期時間
  target_month INT NOT NULL,               -- 鎖定的月份 (1-12)
  target_year INT NOT NULL,                -- 鎖定的年份
  description TEXT,                        -- 凍結說明
  is_active BOOLEAN DEFAULT TRUE,          -- 是否啟用
  created_by INT NOT NULL,                 -- 創建者員工ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES employees(id)
);
```

### API 設計

#### GET /api/attendance-freeze
獲取所有凍結設定列表
- **權限**: ADMIN, HR
- **回傳**: 凍結設定數組

#### POST /api/attendance-freeze
創建新的凍結設定
- **權限**: ADMIN
- **參數**:
  - `freezeDate`: 凍結日期時間
  - `targetMonth`: 鎖定月份
  - `targetYear`: 鎖定年份
  - `description`: 說明（選填）

## 使用流程

### 1. 設定凍結
1. 管理員登入系統
2. 進入「考勤凍結管理」頁面
3. 點擊「創建凍結設定」
4. 填寫凍結信息：
   - 凍結日期時間
   - 鎖定年份
   - 鎖定月份
   - 凍結原因說明
5. 提交設定

### 2. 凍結生效
- 系統自動檢查當前時間是否超過凍結時間
- 如果超過，則鎖定指定月份的所有申請
- 員工嘗試申請時會收到錯誤提示

### 3. 查看凍結狀態
- 管理員和HR可以在凍結管理頁面查看所有凍結設定
- 可以查看哪些月份被凍結、何時凍結、誰設定的

## 使用場景

### 1. 月結期間凍結
```
場景：每月25日進行薪資結算，需要防止員工修改考勤記錄
設定：
- 凍結日期：每月25日 18:00
- 鎖定月份：當月
- 說明：月結期間凍結
```

### 2. 年終結算凍結
```
場景：年底結算期間，需要鎖定全年考勤記錄
設定：
- 凍結日期：12月20日 17:00
- 鎖定月份：1-12月
- 說明：年終結算凍結
```

### 3. 系統維護凍結
```
場景：系統升級期間暫停所有申請
設定：
- 凍結日期：維護開始時間
- 鎖定月份：當前和下個月
- 說明：系統維護期間凍結
```

### 4. 政策調整過渡期
```
場景：考勤政策調整期間
設定：
- 凍結日期：政策生效前一天
- 鎖定月份：調整涉及的月份
- 說明：政策調整過渡期
```

## 技術實現

### 凍結檢查邏輯
```typescript
// 檢查指定日期是否被凍結
async function checkAttendanceFreeze(targetDate: Date): Promise<boolean> {
  const targetMonth = targetDate.getMonth() + 1;
  const targetYear = targetDate.getFullYear();

  const freeze = await prisma.attendanceFreeze.findFirst({
    where: {
      targetMonth,
      targetYear,
      isActive: true
    }
  });

  if (!freeze) return false;

  // 檢查當前時間是否超過凍結時間
  return new Date() >= freeze.freezeDate;
}
```

### API 整合
在請假、加班、調班 API 中加入凍結檢查：
```typescript
// 在提交申請前檢查凍結狀態
const freezeCheck = await checkAttendanceFreeze(targetDate);
if (freezeCheck.isFrozen) {
  return NextResponse.json({
    error: `該月份已被凍結，無法提交申請`
  }, { status: 403 });
}
```

## 安全考慮

### 1. 權限控制
- 只有管理員可以創建凍結設定
- HR只能查看，不能修改
- 員工無法訪問凍結管理功能

### 2. 操作記錄
- 所有凍結設定操作都會記錄
- 包含操作者、時間、設定內容
- 支持審計追蹤

### 3. 數據完整性
- 凍結設定一旦生效無法刪除
- 可以停用但保留歷史記錄
- 防止惡意修改

## 故障排除

### 常見問題

#### 1. 凍結設定不生效
**問題**: 設定了凍結但員工仍能申請
**解決**:
- 檢查凍結時間是否正確
- 確認當前系統時間
- 查看 API 日誌確認檢查邏輯

#### 2. 誤設凍結時間
**問題**: 設定了錯誤的凍結時間
**解決**:
- 建立新的凍結設定覆蓋舊的
- 或停用錯誤的凍結設定

#### 3. 權限錯誤
**問題**: 非管理員無法訪問
**解決**:
- 檢查用戶角色設定
- 確認登入狀態

## 未來擴展

### 1. 自動凍結
- 根據排程自動設定凍結
- 支援定期凍結模式

### 2. 部分凍結
- 支援部分功能凍結
- 例如只凍結加班，不凍結請假

### 3. 通知系統
- 凍結前發送通知
- 凍結生效提醒

### 4. 報表功能
- 凍結歷史報表
- 影響範圍統計

## 總結

考勤凍結管理系統為長福會提供了強有力的考勤數據保護機制，確保在關鍵時期考勤記錄的完整性和準確性。通過精確的時間控制和權限管理，系統能夠靈活適應各種業務場景的需求，同時保證操作的安全性和透明性。

---

*本文檔版本: 1.0*
*更新日期: 2025年9月3日*
*維護人員: 系統管理員*
