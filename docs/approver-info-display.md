# 審核流程批准者信息顯示功能

## 概述

我們已經為請假、加班和調班的審核流程添加了批准者信息顯示功能，員工現在可以在這些頁面中看到批准者的員編、姓名和職位。

## 主要更新

### 1. 數據庫結構更新
- **LeaveRequest**: 添加 `approver Employee?` 關聯
- **OvertimeRequest**: 添加 `approver Employee?` 關聯
- **Employee**: 添加對應的審核關聯

### 2. API 更新
- **請假請求API** (`/api/leave-requests`): 包含批准者詳細信息
- **加班請求API** (`/api/overtime-requests`): 包含批准者詳細信息
- **調班請求API** (`/api/shift-exchanges`): 已包含批准者詳細信息

### 3. 前端組件更新

#### 請假管理頁面 (`/leave-management`)
- 添加"批准者"列
- 顯示格式: `姓名 (員編 • 職位)`
- 未批准時顯示"尚未批准"

#### 加班管理頁面 (`/overtime-management`)
- 添加"批准者"列
- 顯示格式: `姓名 (員編 • 職位)`
- 未批准時顯示"尚未批准"

#### 調班管理頁面 (`/shift-exchange`)
- 更新批准者信息顯示
- 顯示格式: `姓名 (員編 • 職位)`
- 包含批准時間

## 顯示格式

### 批准者信息格式
```
張三
(EMP001 • 經理)
```

### 未批准狀態
```
尚未批准
```

## 權限說明

- **員工權限**: 可以查看所有已批准申請的批准者信息
- **管理員權限**: 可以查看所有申請的批准者信息，包括待審核的

## 技術實現

### 數據關聯
```prisma
model LeaveRequest {
  // ... 其他欄位
  approvedBy Int?
  approver   Employee? @relation("LeaveRequestApprover", fields: [approvedBy], references: [id])
}

model OvertimeRequest {
  // ... 其他欄位
  approvedBy Int?
  approver   Employee? @relation("OvertimeRequestApprover", fields: [approvedBy], references: [id])
}
```

### API 查詢
```typescript
include: {
  employee: { /* ... */ },
  approver: {
    select: {
      id: true,
      employeeId: true,
      name: true,
      department: true,
      position: true
    }
  }
}
```

### 前端顯示
```tsx
{request.approver ? (
  <div className="flex items-center gap-2">
    <div className="text-gray-900 font-medium">
      {request.approver.name}
    </div>
    <div className="text-xs text-gray-500">
      {request.approver.employeeId} • {request.approver.position || 'N/A'}
    </div>
  </div>
) : (
  <span className="text-gray-400">尚未批准</span>
)}
```

## 遷移說明

系統已自動應用數據庫遷移，現有數據保持兼容。

## 使用說明

1. **查看請假記錄**: 訪問請假管理頁面，查看"批准者"列
2. **查看加班記錄**: 訪問加班管理頁面，查看"批准者"列
3. **查看調班記錄**: 訪問調班管理頁面，查看批准者信息

## 故障排除

### 批准者信息不顯示
1. 確認申請已獲得批准
2. 檢查用戶權限
3. 查看瀏覽器控制台是否有錯誤

### 信息顯示不完整
1. 確認批准者員工記錄完整
2. 檢查員編和職位欄位是否已填寫

## 未來擴展

- 支持多級審核流程
- 添加審核意見顯示
- 支持審核歷史追蹤
