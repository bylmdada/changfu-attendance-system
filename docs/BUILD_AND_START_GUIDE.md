# 長福會考勤系統 - 構建和啟動指南

## 📋 構建流程

### 步驟 1: 執行構建
在專案根目錄執行：
```bash
npm run build
```

這個命令會：
- ✅ 編譯所有TypeScript文件
- ✅ 打包所有React組件
- ✅ 優化靜態資源
- ✅ 生成`.next`目錄（生產環境構建）

**預計時間**: 1-3分鐘

### 步驟 2: 等待構建完成
構建成功後，您會看到類似的輸出：
```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Collecting page data
✓ Generating static pages (xx/xx)
✓ Collecting build traces
✓ Finalizing page optimization

Route (app)                              Size     First Load JS
┌ ○ /                                    xxx kB         xxx kB
├ ○ /api/...                            xxx kB         xxx kB
└ ...

○  (Static)  prerendered as static content
```

### 步驟 3: 啟動生產服務器
構建完成後，執行：
```bash
npm run start-https
```

或使用標準HTTP：
```bash
npm run start
```

## 🚀 快速啟動命令

### 開發環境（推薦用於開發）
```bash
npm run dev
```
- 熱重載
- 即時編譯
- 無需構建
- 端口：3001

### 生產環境（用於測試或部署）
```bash
# 1. 構建
npm run build

# 2. 啟動（選擇其中一個）
npm run start        # HTTP模式
npm run start-https  # HTTPS模式（端口3001）
```

## ⚠️ 常見錯誤和解決方案

### 錯誤 1: "Could not find a production build"
```
Error: Could not find a production build in the '.next' directory.
```

**原因**: 還沒有執行構建或構建失敗

**解決方案**:
```bash
# 1. 清理舊的構建（如果存在）
rm -rf .next

# 2. 重新構建
npm run build

# 3. 等待構建完成後再啟動
npm run start-https
```

### 錯誤 2: 構建過程中出現TypeScript/ESLint錯誤
**解決方案**:
```bash
# 檢查具體錯誤
npm run lint

# 如果錯誤太多，可以暫時跳過 lint 檢查構建
npm run build -- --no-lint

# 或者修復錯誤後重新構建
npm run build
```

**注意**: 項目已配置將大部分錯誤降級為警告，不會阻止構建。

### 錯誤 3: 端口被占用
```
Error: Port 3001 is already in use
```

**解決方案**:
```bash
# 選項1: 殺掉佔用端口的進程
lsof -ti:3001 | xargs kill -9

# 選項2: 使用不同的端口
next start --port 3002
```

## 🔍 檢查構建狀態

### 檢查.next目錄是否存在
```bash
ls -la | grep .next
```

如果看到`.next`目錄，說明構建已完成。

### 檢查構建大小
```bash
du -sh .next
```

正常情況下，`.next`目錄大小應該在50-200MB之間。

## 📊 構建優化建議

### 減少構建時間
1. 使用`--turbopack`（已在dev腳本中配置）
2. 關閉不必要的優化（僅開發環境）
3. 使用增量構建

### 減少構建大小
1. 移除未使用的依賴
2. 優化圖片資源
3. 使用動態導入（lazy loading）

## 🎯 推薦工作流程

### 日常開發
```bash
npm run dev
```
- 最快的反饋循環
- 自動重載
- 適合快速迭代

### 測試生產環境
```bash
# 每次修改後
npm run build && npm run start-https
```
- 驗證生產環境行為
- 檢查性能
- 測試優化效果

### 部署前檢查
```bash
# 1. 清理
rm -rf .next node_modules

# 2. 重新安裝依賴
npm install

# 3. 構建
npm run build

# 4. 測試
npm run start-https

# 5. 驗證所有功能
```

## 📝 環境變量配置

創建`.env.local`文件（如果還沒有）：
```env
DATABASE_URL="file:./prisma/dev.db"
NEXTAUTH_URL="https://localhost:3001"
NODE_ENV="production"
```

## 🔐 HTTPS配置（可選）

如果需要真正的HTTPS（不是自簽名證書）：

1. 安裝mkcert
```bash
brew install mkcert
mkcert -install
```

2. 生成證書
```bash
mkcert localhost 127.0.0.1 ::1
```

3. 配置Next.js使用HTTPS
（需要自定義服務器配置）

## ✅ 驗證清單

構建和啟動後，檢查：
- [ ] 應用可以訪問（http://localhost:3001）
- [ ] 登入功能正常
- [ ] 考勤打卡功能正常
- [ ] GPS定位功能正常
- [ ] 分頁功能正常
- [ ] 無Console錯誤
- [ ] 所有API端點響應正常

## 📞 需要幫助？

如果遇到問題：
1. 查看構建日誌中的錯誤信息
2. 檢查`.next`目錄是否存在
3. 驗證所有依賴已正確安裝
4. 查看Console中的錯誤

構建成功後，您應該能夠使用生產模式運行應用程序！🚀
