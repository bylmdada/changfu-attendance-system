# 員工權限管理系統 - 請假、加班、調班申請

## 概述

員工權限管理系統是長福會考勤系統的核心安全組件，負責控制員工對請假、加班、調班等考勤申請功能的訪問權限。系統採用角色-based權限控制（RBAC），確保員工只能訪問授權的功能，同時保護敏感的考勤數據。

## 權限架構

### 角色定義

#### 1. EMPLOYEE（一般員工）
- **基本權限**: 查看個人考勤記錄、提交個人申請
- **申請權限**: 可提交請假、加班、調班申請
- **查看權限**: 只能查看自己的申請和記錄
- **操作限制**: 無法審核他人申請，無法修改系統設定

#### 2. HR（人力資源）
- **擴展權限**: 除了員工權限外，還可查看所有員工的基本信息
- **審核權限**: 可審核請假、加班、調班申請
- **管理權限**: 可管理員工基本資料、查看統計報表
- **限制**: 無法修改系統核心設定，無法訪問管理員專用功能

#### 3. ADMIN（系統管理員）
- **最高權限**: 系統所有功能的完全訪問權限
- **設定權限**: 可修改系統設定、權限配置、凍結設定
- **管理權限**: 可管理所有用戶帳號、系統參數
- **審核權限**: 可審核所有類型的申請

### 權限矩陣

| 功能模組 | EMPLOYEE | HR | ADMIN |
|---------|----------|----|-------|
| 個人請假申請 | ✅ | ✅ | ✅ |
| 查看個人請假記錄 | ✅ | ✅ | ✅ |
| 審核請假申請 | ❌ | ✅ | ✅ |
| 查看所有請假記錄 | ❌ | ✅ | ✅ |
| 個人加班申請 | ✅ | ✅ | ✅ |
| 查看個人加班記錄 | ✅ | ✅ | ✅ |
| 審核加班申請 | ❌ | ✅ | ✅ |
| 查看所有加班記錄 | ❌ | ✅ | ✅ |
| 個人調班申請 | ✅ | ✅ | ✅ |
| 查看個人調班記錄 | ✅ | ✅ | ✅ |
| 審核調班申請 | ❌ | ✅ | ✅ |
| 查看所有調班記錄 | ❌ | ✅ | ✅ |
| 系統設定管理 | ❌ | ❌ | ✅ |
| 用戶權限管理 | ❌ | ❌ | ✅ |
| 考勤凍結設定 | ❌ | ❌ | ✅ |

## 數據庫設計

### User 表 - 用戶權限核心

```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTOINCREMENT,
  employee_id INT UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'EMPLOYEE', -- EMPLOYEE, HR, ADMIN
  is_active BOOLEAN DEFAULT TRUE,
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

**關鍵欄位說明**:
- `role`: 決定用戶的權限等級
- `is_active`: 控制帳號是否可用
- `employee_id`: 關聯到員工基本信息

### 申請表權限關聯

#### LeaveRequest 表 - 請假申請權限

```sql
CREATE TABLE leave_requests (
  id INT PRIMARY KEY AUTOINCREMENT,
  employee_id INT NOT NULL,
  leave_type VARCHAR(20) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days DECIMAL(5,2) NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
  approved_by INT, -- 審核者ID
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (approved_by) REFERENCES employees(id)
);
```

#### OvertimeRequest 表 - 加班申請權限

```sql
CREATE TABLE overtime_requests (
  id INT PRIMARY KEY AUTOINCREMENT,
  employee_id INT NOT NULL,
  overtime_date DATE NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  total_hours DECIMAL(4,2) NOT NULL,
  reason TEXT NOT NULL,
  work_content TEXT,
  status VARCHAR(20) DEFAULT 'PENDING',
  approved_by INT,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (approved_by) REFERENCES employees(id)
);
```

#### ShiftExchangeRequest 表 - 調班申請權限

```sql
CREATE TABLE shift_exchange_requests (
  id INT PRIMARY KEY AUTOINCREMENT,
  requester_id INT NOT NULL,
  target_employee_id INT NOT NULL,
  original_work_date VARCHAR(10) NOT NULL,
  target_work_date VARCHAR(10) NOT NULL,
  request_reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  admin_remarks TEXT,
  approved_by INT,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requester_id) REFERENCES employees(id),
  FOREIGN KEY (target_employee_id) REFERENCES employees(id),
  FOREIGN KEY (approved_by) REFERENCES employees(id)
);
```

## API 權限控制

### 認證中間件

```typescript
// src/lib/auth.ts
export function verifyToken(token: string): JWTPayload | null {
  try {
    const secret = process.env.JWT_SECRET || 'your-secret-key';
    return jwt.verify(token, secret) as JWTPayload;
  } catch {
    return null;
  }
}

export interface JWTPayload {
  userId: number;
  employeeId: number;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}
```

### 權限檢查工具函數

```typescript
// src/lib/permissions.ts
export function hasPermission(userRole: string, requiredRole: string): boolean {
  const roleHierarchy = {
    'EMPLOYEE': 1,
    'HR': 2,
    'ADMIN': 3
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

export function canApproveRequests(userRole: string): boolean {
  return ['HR', 'ADMIN'].includes(userRole);
}

export function canViewAllRecords(userRole: string): boolean {
  return ['HR', 'ADMIN'].includes(userRole);
}

export function canManageSystem(userRole: string): boolean {
  return userRole === 'ADMIN';
}
```

### API 端點權限控制

#### 請假申請 API

```typescript
// src/app/api/leave-requests/route.ts
export async function GET(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                request.cookies.get('auth-token')?.value;

  if (!token) {
    return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get('employeeId');

  // 建立篩選條件
  const where: any = {};

  // 權限控制：一般員工只能查看自己的記錄
  if (decoded.role === 'EMPLOYEE') {
    where.employeeId = decoded.employeeId;
  } else if (employeeId) {
    // HR和ADMIN可以查看指定員工或所有員工的記錄
    where.employeeId = parseInt(employeeId);
  }

  // ... 其餘查詢邏輯
}
```

#### 審核權限檢查

```typescript
export async function PATCH(request: NextRequest) {
  // ... 認證檢查

  // 檢查審核權限
  if (!canApproveRequests(decoded.role)) {
    return NextResponse.json({ error: '權限不足，無法審核申請' }, { status: 403 });
  }

  // ... 審核邏輯
}
```

## 前端權限處理

### 權限 Hook

```typescript
// src/hooks/usePermissions.ts
import { useAuth } from '@/contexts/AuthContext';

export function usePermissions() {
  const { user } = useAuth();

  const hasPermission = (requiredRole: string) => {
    if (!user) return false;

    const roleHierarchy = {
      'EMPLOYEE': 1,
      'HR': 2,
      'ADMIN': 3
    };

    return roleHierarchy[user.role] >= roleHierarchy[requiredRole];
  };

  const canApprove = () => hasPermission('HR');
  const canViewAll = () => hasPermission('HR');
  const canManageSystem = () => user?.role === 'ADMIN';

  return {
    hasPermission,
    canApprove: canApprove(),
    canViewAll: canViewAll(),
    canManageSystem: canManageSystem(),
    userRole: user?.role
  };
}
```

### 組件權限控制

```typescript
// src/components/ApproveButton.tsx
import { usePermissions } from '@/hooks/usePermissions';

interface ApproveButtonProps {
  onApprove: () => void;
  disabled?: boolean;
}

export function ApproveButton({ onApprove, disabled }: ApproveButtonProps) {
  const { canApprove } = usePermissions();

  if (!canApprove) {
    return null; // 沒有權限的不顯示按鈕
  }

  return (
    <button
      onClick={onApprove}
      disabled={disabled}
      className="bg-green-500 text-white px-4 py-2 rounded"
    >
      批准
    </button>
  );
}
```

### 頁面級權限保護

```typescript
// src/components/ProtectedRoute.tsx
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: string;
  fallback?: React.ReactNode;
}

export function ProtectedRoute({
  children,
  requiredRole = 'EMPLOYEE',
  fallback = <div>權限不足</div>
}: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const { hasPermission } = usePermissions();

  if (loading) {
    return <div>載入中...</div>;
  }

  if (!user || !hasPermission(requiredRole)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
```

## 安全考慮

### 1. 數據隔離
- **行級安全**: 員工只能訪問自己的數據
- **欄級安全**: 敏感信息只對授權角色可見
- **審計追蹤**: 所有操作記錄詳細日誌

### 2. 認證安全
- **JWT Token**: 使用安全的JWT進行身份驗證
- **Token過期**: 設定合理的token過期時間
- **密碼安全**: 使用bcrypt進行密碼雜湊

### 3. API安全
- **請求驗證**: 每個API請求都進行權限檢查
- **輸入驗證**: 防止SQL注入和XSS攻擊
- **速率限制**: 防止暴力攻擊

### 4. 前端安全
- **權限檢查**: 前端和後端都進行權限驗證
- **敏感信息**: 不將敏感權限信息暴露給前端
- **安全渲染**: 防止XSS攻擊

## 權限管理流程

### 1. 用戶註冊與權限分配
1. HR創建員工基本信息
2. 系統自動創建用戶帳號（預設EMPLOYEE角色）
3. 管理員根據需要調整用戶權限

### 2. 權限變更流程
1. 管理員在用戶管理頁面選擇用戶
2. 修改用戶角色
3. 系統記錄權限變更日誌
4. 用戶下次登入時權限生效

### 3. 權限審計
- **操作日誌**: 記錄所有權限相關操作
- **定期審查**: 定期檢查權限分配是否合理
- **異常監控**: 監控異常權限使用行為

## 故障排除

### 常見權限問題

#### 1. 用戶無法訪問功能
**問題**: 員工反映無法訪問某些功能
**檢查**:
- 確認用戶角色設定
- 檢查權限矩陣配置
- 查看API權限檢查邏輯

#### 2. 權限升級失敗
**問題**: 管理員修改權限後用戶仍無權限
**解決**:
- 確認資料庫已更新
- 檢查用戶是否需要重新登入
- 查看快取是否影響權限檢查

#### 3. 權限降級問題
**問題**: 用戶權限被降級但仍能訪問高權限功能
**解決**:
- 強制用戶重新登入
- 清除相關快取
- 檢查前端權限檢查邏輯

## 權限測試策略

### 單元測試
```typescript
// src/__tests__/permissions.test.ts
describe('權限檢查', () => {
  test('員工不能審核申請', () => {
    expect(hasPermission('EMPLOYEE', 'HR')).toBe(false);
  });

  test('HR可以審核申請', () => {
    expect(hasPermission('HR', 'HR')).toBe(true);
  });

  test('管理員可以管理系統', () => {
    expect(canManageSystem('ADMIN')).toBe(true);
  });
});
```

### 整合測試
- **API測試**: 測試不同權限用戶的API訪問
- **前端測試**: 測試權限組件的渲染行為
- **端到端測試**: 模擬完整的使用者流程

## 未來擴展

### 1. 細粒度權限
- **功能級權限**: 更細緻的功能訪問控制
- **數據級權限**: 基於數據內容的訪問控制
- **時間段權限**: 特定時間的權限控制

### 2. 動態權限
- **臨時權限**: 臨時授予特定權限
- **條件權限**: 基於條件動態調整權限
- **代理權限**: 權限委派機制

### 3. 權限分析
- **權限使用分析**: 分析權限使用情況
- **權限覆蓋報告**: 檢查權限配置完整性
- **安全審計報表**: 生成權限安全報告

## 總結

員工權限管理系統通過層次化的角色設計、嚴格的權限檢查和完善的安全機制，確保了請假、加班、調班等考勤申請功能的有序運行。系統不僅保護了敏感的考勤數據，還提供了靈活的權限管理能力，適應長福會不斷變化的管理需求。

---

*本文檔版本: 1.0*
*更新日期: 2025年9月3日*
*維護人員: 系統管理員*
