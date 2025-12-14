# 🔒 HTTPS GPS 定位打卡系統啟動指南

**目標：** 啟動 HTTPS 服務器，支持 GPS 定位打卡功能

---

## 🚀 快速啟動 HTTPS 服務器

### **方法 1：使用自定義 HTTPS 服務器 (推薦)**

```bash
# 1. 檢查並生成證書
node check-https.js

# 2. 啟動 HTTPS 服務器
npm run dev:https-network
```

### **方法 2：手動設置證書**

```bash
# 1. 進入證書目錄
cd certs

# 2. 生成私鑰 (如果不存在)
openssl genrsa -out server.key 2048

# 3. 生成證書 (如果不存在)
openssl req -new -x509 -key server.key -out server.crt -days 365 -config localhost.conf -extensions v3_req

# 4. 返回項目根目錄
cd ..

# 5. 啟動 HTTPS 服務器
npm run dev:https-network
```

---

## 🌐 訪問地址

### **電腦訪問：**
```
https://localhost:3001
```

### **手機訪問 (同 WiFi 網路)：**
```
https://192.168.1.149:3001
```
*註：IP 地址可能不同，請查看終端顯示的實際地址*

---

## 📱 GPS 定位打卡功能

### **為什麼需要 HTTPS？**
- 現代瀏覽器的安全政策要求
- GPS 定位 API 只能在 HTTPS 環境下運作
- 確保定位資料傳輸安全

### **打卡頁面訪問：**
```
https://localhost:3001/attendance/clock
https://192.168.1.149:3001/attendance/clock
```

### **GPS 功能測試：**
1. 使用手機瀏覽器訪問打卡頁面
2. 允許位置權限請求
3. 系統自動獲取 GPS 座標
4. 驗證是否在允許的打卡地點範圍內

---

## 🔐 安全警告處理

### **瀏覽器安全警告：**
1. **Chrome/Edge:** 點擊「進階」→「繼續前往 localhost (不安全)」
2. **Firefox:** 點擊「進階」→「接受風險並繼續」
3. **Safari:** 點擊「顯示詳細資訊」→「造訪此網站」

### **手機瀏覽器：**
1. 看到「不安全連線」警告
2. 點擊「進階選項」
3. 選擇「繼續前往網站」

---

## ⚙️ 系統配置檢查

### **證書文件檢查：**
```bash
ls -la certs/
# 應該看到：
# server.key (私鑰)
# server.crt (證書)
# localhost.conf (配置)
```

### **端口檢查：**
```bash
# 檢查端口 3001 是否可用
lsof -i :3001

# 如果被占用，可以殺死進程
kill -9 <PID>
```

### **網路連接測試：**
```bash
# 測試本機 HTTPS 連接
curl -k https://localhost:3001

# 測試網路 HTTPS 連接 (替換為實際 IP)
curl -k https://192.168.1.149:3001
```

---

## 🔧 常見問題解決

### **問題 1：證書錯誤**
```bash
# 解決方案：重新生成證書
rm -rf certs/server.*
node check-https.js
```

### **問題 2：端口被占用**
```bash
# 解決方案：更改端口或殺死占用進程
PORT=3002 npm run dev:https-network
```

### **問題 3：手機無法訪問**
- 確認手機和電腦在同一 WiFi 網路
- 檢查防火牆設置
- 確認 IP 地址正確

### **問題 4：GPS 無法獲取**
- 確認使用 HTTPS 協議
- 檢查瀏覽器位置權限
- 確認在戶外或靠近窗戶

---

## 📊 功能驗證清單

### **✅ HTTPS 服務器**
- [ ] 服務器成功啟動在 3001 端口
- [ ] 電腦可訪問 `https://localhost:3001`
- [ ] 手機可訪問 `https://IP地址:3001`
- [ ] 瀏覽器顯示鎖頭圖標（雖然不受信任）

### **✅ GPS 定位功能**
- [ ] 打卡頁面正常載入
- [ ] 瀏覽器請求位置權限
- [ ] 成功獲取 GPS 座標
- [ ] 地點驗證功能正常

### **✅ 系統監控**
- [ ] 監控頁面可訪問：`/system-monitoring`
- [ ] 系統健康檢查正常
- [ ] 資料庫連接正常

---

## 🎯 完整啟動流程

```bash
# 1. 檢查和設置 HTTPS 環境
node check-https.js

# 2. 啟動 HTTPS 服務器
npm run dev:https-network

# 3. 在瀏覽器中測試
# 電腦: https://localhost:3001
# 手機: https://你的IP:3001

# 4. 測試 GPS 打卡功能
# 訪問: https://localhost:3001/attendance/clock
```

---

## 🎉 成功標準

**當您看到以下輸出時，表示配置成功：**

```
🔒 HTTPS網路服務器啟動成功！

📱 手機可使用以下網址訪問：
   https://192.168.1.149:3001

💻 電腦可使用以下網址訪問：
   https://localhost:3001
   https://127.0.0.1:3001
   https://192.168.1.149:3001

🎯 GPS 定位功能現在可以在 HTTPS 環境下正常運作！
```

**現在您的考勤系統已經完美支持 HTTPS 和 GPS 定位打卡功能！** 🚀
