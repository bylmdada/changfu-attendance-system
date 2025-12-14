# 系統設定頁面身份驗證修復報告

## 問題描述
系統設定子頁面在訪問時出現 403 Forbidden 錯誤：
```
GET http://localhost:3001/api/auth/verify 403 (Forbidden)
```

## 根本原因
系統設定的子頁面仍在使用舊的 `/api/auth/verify` 端點進行身份驗證，而該端點可能存在權限問題。其他頁面已經統一使用 `/api/auth/me` 端點。

## 修復方案
將所有系統設定頁面統一使用新的身份驗證模式：

### 修復模式
**舊代碼：**
```typescript
const response = await fetch('/api/auth/verify', {
  credentials: 'include'
});
```

**新代碼：**
```typescript
// Helper function to get auth headers
const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const response = await fetch('/api/auth/me', {
  credentials: 'include',
  headers: getAuthHeaders()
});

if (response.ok) {
  const userData = await response.json();
  const currentUser = userData.user || userData;
  
  if (currentUser.role !== 'ADMIN') {
    router.push('/dashboard');
    return;
  }
  setUser(currentUser);
} else if (response.status === 401 || response.status === 403) {
  console.warn('Authentication failed, redirecting to login');
  router.push('/login');
} else {
  router.push('/login');
}
```

## 已修復的文件

### ✅ 完全修復
1. `src/app/system-settings/page.tsx` - 主系統設定頁面
2. `src/app/system-settings/gps-attendance/page.tsx` - GPS打卡設定
3. `src/app/system-settings/attendance-freeze/page.tsx` - 考勤凍結管理
4. `src/app/system-settings/attendance-permissions/page.tsx` - 考勤權限管理
5. `src/app/system-settings/overtime-calculation/page.tsx` - 加班費計算管理
6. `src/app/system-settings/bonus-management/page.tsx` - 獎金管理系統
7. `src/app/system-settings/supplementary-premium/page.tsx` - 補充保費計算
8. `src/app/system-settings/health-insurance-dependents/page.tsx` - 健保眷屬管理

### ✅ 已經正確
- `src/app/system-settings/department-positions/page.tsx` - 部門職位管理（已使用正確端點）

### ⚠️ 需要驗證
以下文件可能還需要檢查和更新：
- `src/app/system-settings/prorated-bonus/page.tsx` - 按比例獎金系統
- `src/app/system-settings/health-insurance-formula/page.tsx` - 健保公式配置
- `src/app/system-settings/payslip-management/page.tsx` - 薪資條管理系統

## 關鍵改進

### 1. 統一身份驗證
- 所有頁面使用相同的 `/api/auth/me` 端點
- 統一的錯誤處理邏輯
- 增加更詳細的錯誤狀態處理

### 2. 增強的錯誤處理
- 區分 401 和 403 錯誤
- 更清晰的控制台警告訊息
- 確保在驗證失敗時正確重定向

### 3. 一致性改進
- 統一的 getAuthHeaders 輔助函數
- 一致的用戶數據處理方式
- 標準化的重定向邏輯

## 測試建議

### 手動測試步驟：
1. 以管理員身份登入
2. 進入系統設定頁面
3. 逐一點擊各項細部設定頁面：
   - GPS打卡設定
   - 考勤凍結管理
   - 考勤權限管理
   - 加班費計算管理
   - 獎金管理系統
   - 補充保費計算
   - 健保眷屬管理
   - 等等
4. 確認沒有出現 403 錯誤
5. 確認沒有強制登出現象

### 預期結果：
- ✅ 所有系統設定頁面正常載入
- ✅ 不再出現 403 Forbidden 錯誤
- ✅ 管理員可以正常訪問所有功能
- ✅ 非管理員會被正確重定向到首頁

## 後續工作
1. 完成剩餘 3 個頁面的驗證和修復
2. 進行完整的迴歸測試
3. 考慮統一所有頁面的身份驗證模式
4. 建立身份驗證的標準化組件或 Hook

---
**修復狀態：** 🟡 大部分完成，需要最終驗證
**修復時間：** 2025年10月27日
**影響範圍：** 系統設定模組全部頁面
