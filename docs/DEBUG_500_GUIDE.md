# 🔧 打卡系統 500 錯誤修正指南

## ✅ 已修正的問題

### 1. 資料庫日期格式不匹配
- **問題**: `workDate` 字段是 `DateTime` 類型，但使用字符串查詢
- **修正**: 改用日期範圍查詢 `{ gte: todayStart, lt: todayEnd }`

### 2. Prisma 客戶端導入
- **問題**: 直接創建 PrismaClient 實例
- **修正**: 使用統一的 `@/lib/database` 導入

## 🧪 測試步驟

### 1. 測試資料庫連接
```bash
# 訪問測試 API
curl http://localhost:3000/api/test-db
# 或在瀏覽器打開：http://localhost:3000/api/test-db
```

### 2. 測試打卡狀態查詢
```bash
# 需要先登入，然後訪問
http://localhost:3000/api/attendance/clock
```

### 3. 測試身份驗證調試
```bash
# 訪問調試頁面
http://localhost:3000/debug-auth
```

## 🚀 啟動系統

1. **確保依賴已安裝**:
   ```bash
   cd /Users/feng/changfu-attendance-system/changfu-attendance-system/changfu-attendance-system/changfu-attendance-system
   npm install
   ```

2. **生成 Prisma 客戶端**:
   ```bash
   npx prisma generate
   ```

3. **檢查資料庫**:
   ```bash
   npx prisma studio
   ```

4. **啟動開發服務器**:
   ```bash
   npm run dev
   ```

## 📋 完整測試流程

### 階段 1: 基礎測試
1. **訪問測試 API**: `http://localhost:3000/api/test-db`
   - ✅ 如果看到成功回應和資料統計，表示資料庫連接正常
   - ❌ 如果出現錯誤，檢查資料庫文件和 Prisma 配置

2. **檢查調試頁面**: `http://localhost:3000/debug-auth`
   - ✅ 如果身份驗證狀態正常，可以進行下一步
   - ❌ 如果顯示未登入，先登入系統

### 階段 2: 登入測試
1. **訪問登入頁面**: `http://localhost:3000/login`
2. **使用測試帳號登入**:
   - 管理員: `admin` / `admin123`
   - 員工: `employee001` / `password123`

### 階段 3: 打卡功能測試
1. **訪問考勤頁面**: `http://localhost:3000/attendance`
2. **點擊上班打卡按鈕**
3. **在驗證對話框中輸入帳號密碼**
4. **確認打卡並檢查結果**

## 🔍 錯誤排除

### 如果仍出現 500 錯誤:

1. **檢查伺服器 Console**:
   - 查看詳細的錯誤信息
   - 注意 Prisma 相關錯誤

2. **檢查資料庫文件**:
   ```bash
   ls -la prisma/dev.db
   ```

3. **重新生成 Prisma 客戶端**:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **檢查環境變數**:
   ```bash
   echo $DATABASE_URL
   # 或檢查 .env 文件
   ```

### 常見問題解決方案:

1. **資料庫鎖定**:
   ```bash
   # 重啟開發服務器
   # Ctrl+C 然後重新 npm run dev
   ```

2. **Prisma 客戶端過期**:
   ```bash
   rm -rf node_modules/.prisma
   npx prisma generate
   ```

3. **日期時區問題**:
   - 系統已修正為使用本地日期範圍查詢
   - 不再依賴字符串比較

## 📊 期望的測試結果

### 成功的測試 API 回應:
```json
{
  "success": true,
  "data": {
    "userCount": 2,
    "employeeCount": 2,
    "attendanceCount": 0,
    "todayAttendances": 0,
    "todayRange": {
      "start": "2025-01-20T00:00:00.000Z",
      "end": "2025-01-21T00:00:00.000Z"
    },
    "todayRecords": []
  }
}
```

### 成功的打卡回應:
```json
{
  "message": "王小明 上班打卡成功",
  "clockInTime": "2025-01-20T10:30:00.000Z",
  "employee": "王小明",
  "attendance": { ... }
}
```

---

**🎉 如果測試 API 正常回應，打卡功能應該已經修正完成！**
