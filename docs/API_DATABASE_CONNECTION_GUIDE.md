# API與數據庫連接說明文檔

## 概述

本文檔詳細說明了長富考勤系統中各API端點與數據庫的連接方式、查詢邏輯、權限控制和數據交互模式。系統採用Next.js 15.4.1 + Prisma ORM + SQLite的技術架構。

## 系統架構

### 技術棧
- **前端框架**: Next.js 15.4.1 (App Router)
- **數據庫ORM**: Prisma ORM
- **數據庫**: SQLite
- **認證方式**: JWT Token + Cookie
- **權限系統**: 角色基權限控制 (ADMIN/HR/EMPLOYEE)

### 數據庫連接配置
```typescript
// src/lib/database.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

## API端點詳解

### 1. 請假申請API (`/api/leave-requests`)

#### GET - 查詢請假記錄
**數據庫交互**:
- **查詢表**: `leaveRequest`
- **關聯表**: `employee` (申請者), `approver` (審核者)
- **權限控制**: 員工只能查看自己的記錄，管理員/HR可查看所有記錄

**查詢邏輯**:
```sql
SELECT lr.*, e.name, e.department, a.name as approver_name
FROM leaveRequest lr
LEFT JOIN employee e ON lr.employeeId = e.id
LEFT JOIN employee a ON lr.approverId = a.id
WHERE (lr.employeeId = ? OR ? IN ('ADMIN', 'HR'))
ORDER BY lr.createdAt DESC
```

**篩選條件**:
- `employeeId`: 員工ID (管理員權限)
- `status`: 申請狀態 (PENDING/APPROVED/REJECTED)
- `startDate`/`endDate`: 日期範圍

#### POST - 創建請假申請
**數據庫操作**:
1. 驗證凍結狀態 (調用 `checkAttendanceFreeze`)
2. 檢查時間重疊 (防止重複請假)
3. 創建記錄到 `leaveRequest` 表

**業務規則**:
- 請假時數必須為30分鐘倍數
- 不能在凍結期間提交申請
- 檢查日期重疊避免衝突

### 2. 加班申請API (`/api/overtime-requests`)

#### GET - 查詢加班記錄
**數據庫交互**:
- **查詢表**: `overtimeRequest`
- **關聯表**: `employee`, `approver`, `schedule`
- **特殊處理**: 動態獲取當日班別信息

**查詢邏輯**:
```sql
SELECT or.*, e.name, e.department, s.shiftType, s.startTime, s.endTime
FROM overtimeRequest or
LEFT JOIN employee e ON or.employeeId = e.id
LEFT JOIN employee a ON or.approverId = a.id
LEFT JOIN schedule s ON s.employeeId = or.employeeId
  AND s.workDate = DATE(or.overtimeDate)
WHERE (or.employeeId = ? OR ? IN ('ADMIN', 'HR'))
ORDER BY or.createdAt DESC
```

#### POST - 創建加班申請
**業務驗證**:
- 加班開始時間必須在17:00之後
- 加班時數: 0.5-4小時
- 總工作時數不能超過12小時
- 檢查凍結狀態

**數據庫操作**:
```sql
INSERT INTO overtimeRequest
(employeeId, overtimeDate, startTime, endTime, totalHours, reason, status)
VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
```

### 3. 調班申請API (`/api/shift-exchanges`)

#### GET - 查詢調班記錄
**數據庫交互**:
- **查詢表**: `shiftExchangeRequest`
- **關聯表**: `requester`, `targetEmployee`, `approver`
- **數據正規化**: 處理自調班和互調班的不同格式

**查詢邏輯**:
```sql
SELECT ser.*, r.name as requester_name, t.name as target_name, a.name as approver_name
FROM shiftExchangeRequest ser
LEFT JOIN employee r ON ser.requesterId = r.id
LEFT JOIN employee t ON ser.targetEmployeeId = t.id
LEFT JOIN employee a ON ser.approverId = a.id
WHERE (ser.requesterId = ? OR ser.targetEmployeeId = ? OR ? IN ('ADMIN', 'HR'))
ORDER BY ser.createdAt DESC
```

#### POST - 創建調班申請
**數據處理**:
- **自調班**: `requesterId = targetEmployeeId`
- **互調班**: `requesterId ≠ targetEmployeeId`
- **JSON存儲**: 將複雜數據序列化存儲在 `requestReason` 字段

**業務規則**:
- 檢查雙重凍結狀態 (原日期和目標日期)
- 支持自調班和員工間調班
- 數據格式正規化處理

### 4. 個人班表API (`/api/my-schedules`)

#### GET - 查詢個人班表
**數據庫交互**:
- **查詢表**: `schedule`
- **關聯表**: `employee`
- **權限控制**: 只能查看自己的班表

**查詢邏輯**:
```sql
SELECT s.*, e.name, e.department, e.position
FROM schedule s
LEFT JOIN employee e ON s.employeeId = e.id
WHERE s.employeeId = ?
  AND s.workDate BETWEEN ? AND ?
ORDER BY s.workDate ASC
```

**參數支持**:
- `year`/`month`: 年月查詢
- `startDate`/`endDate`: 日期範圍查詢

### 5. 員工管理API (`/api/employees`)

#### GET - 查詢員工列表
**數據庫交互**:
- **查詢表**: `employee`
- **關聯表**: `user`
- **權限控制**: 僅管理員可訪問

**查詢邏輯**:
```sql
SELECT e.*, u.username, u.role, u.isActive
FROM employee e
LEFT JOIN user u ON e.id = u.employeeId
WHERE e.name LIKE ? OR e.employeeId LIKE ?
ORDER BY e.createdAt DESC
LIMIT ? OFFSET ?
```

#### POST - 創建員工
**數據庫操作**:
- **事務處理**: 使用Prisma事務確保數據一致性
- **雙表操作**: 同時創建 `employee` 和 `user` 記錄

**業務流程**:
1. 驗證員工編號唯一性
2. 驗證用戶名唯一性 (如需創建帳號)
3. 事務中創建員工記錄
4. 如需創建帳號，同時創建用戶記錄

### 6. 薪資管理API (`/api/payroll`)

#### GET - 查詢薪資記錄
**數據庫交互**:
- **查詢表**: `payrollRecord`
- **關聯表**: `employee`
- **權限控制**: 員工只能查看自己的薪資

**查詢邏輯**:
```sql
SELECT pr.*, e.name, e.department, e.baseSalary, e.hourlyRate
FROM payrollRecord pr
LEFT JOIN employee e ON pr.employeeId = e.id
WHERE (pr.employeeId = ? OR ? IN ('ADMIN', 'HR'))
  AND pr.payYear = ? AND pr.payMonth = ?
ORDER BY pr.payYear DESC, pr.payMonth DESC
```

#### POST - 創建薪資記錄
**複雜計算邏輯**:
1. 獲取員工基本信息
2. 計算考勤記錄中的工時
3. 計算基本薪資和加班費
4. 調用稅務計算器計算扣除額
5. 創建薪資記錄

**數據依賴**:
- `attendanceRecord`: 考勤記錄用於計算工時
- `tax-calculator`: 稅務計算邏輯

### 7. 考勤記錄API (`/api/attendance/records`)

#### GET - 查詢考勤記錄
**數據庫交互**:
- **查詢表**: `attendanceRecord`
- **權限控制**: 員工只能查看自己的考勤記錄

**查詢邏輯**:
```sql
SELECT ar.*, e.name, e.department
FROM attendanceRecord ar
LEFT JOIN employee e ON ar.employeeId = e.id
WHERE ar.employeeId = ?
  AND ar.workDate BETWEEN ? AND ?
ORDER BY ar.workDate DESC
```

## 權限控制系統

### 角色定義
- **EMPLOYEE**: 普通員工
- **HR**: 人事管理員
- **ADMIN**: 系統管理員

### API權限矩陣

| API端點 | EMPLOYEE | HR | ADMIN |
|--------|----------|----|-------|
| `/api/leave-requests` | 讀取自己的記錄 | 讀取所有記錄 | 讀取所有記錄 |
| `/api/overtime-requests` | 讀取自己的記錄 | 讀取所有記錄 | 讀取所有記錄 |
| `/api/shift-exchanges` | 讀取相關記錄 | 讀取所有記錄 | 讀取所有記錄 |
| `/api/my-schedules` | 讀取自己的班表 | 無權限 | 無權限 |
| `/api/employees` | 無權限 | 無權限 | 完全控制 |
| `/api/payroll` | 讀取自己的薪資 | 完全控制 | 完全控制 |

## 數據完整性與業務規則

### 1. 凍結機制
- **實現方式**: `checkAttendanceFreeze` 函數
- **檢查時機**: 所有申請創建時
- **影響範圍**: 請假、加班、調班申請

### 2. 重複檢查
- **請假**: 檢查時間重疊
- **加班**: 檢查同日期重複申請
- **調班**: 檢查凍結狀態

### 3. 數據驗證
- **時間格式**: 嚴格的時間驗證邏輯
- **數值範圍**: 工時、薪資的合理性檢查
- **必填字段**: 各業務實體的必填字段驗證

## 錯誤處理與日誌

### 錯誤響應格式
```json
{
  "error": "錯誤訊息",
  "status": 400
}
```

### 日誌記錄
- **調試日誌**: 詳細的業務邏輯執行記錄
- **錯誤日誌**: 完整的錯誤堆棧信息
- **性能監控**: 數據庫查詢耗時統計

## 數據庫優化策略

### 1. 索引優化
- 主鍵索引: 所有表的主鍵自動索引
- 外鍵索引: 關聯字段的索引
- 查詢索引: 常用查詢條件的索引

### 2. 查詢優化
- **選擇性字段**: 只查詢需要的字段
- **分頁處理**: 大數據量的分頁查詢
- **連接優化**: 合理的表連接策略

### 3. 緩存策略
- **連接池**: Prisma內建連接池
- **查詢緩存**: 頻繁查詢的結果緩存

## 維護建議

### 1. 數據庫維護
- 定期備份數據庫
- 監控數據庫性能
- 清理過期日誌

### 2. API維護
- 監控API響應時間
- 記錄錯誤日誌
- 定期檢查權限配置

### 3. 安全維護
- 定期更新依賴包
- 檢查安全漏洞
- 審計日誌分析

---

*本文檔基於系統實際代碼分析生成，涵蓋了所有主要API端點的數據庫交互細節。如有變更，請及時更新本文檔。*
