# 推播通知功能說明

## 功能概述

推播通知讓使用者可以即時收到打卡提醒、請假核准等重要通知，即使關閉瀏覽器也能收到。

## 環境限制

### 開發環境 (localhost)

| 項目 | 狀態 |
|------|------|
| Service Worker 註冊 | ❌ SSL 憑證錯誤 |
| 推播訂閱 | ❌ 無法啟用 |
| 其他功能 | ✅ 正常 |

**原因：** 
- 推播通知需要有效的 HTTPS 憑證
- localhost 使用自簽名憑證，瀏覽器會阻擋 Service Worker

**處理方式：**
- 程式碼已靜默處理此錯誤，不顯示紅色錯誤訊息
- 頁面會顯示藍色「開發環境提示」說明

---

### 正式環境 (VPS/雲端)

| 項目 | 狀態 |
|------|------|
| Service Worker 註冊 | ✅ 自動成功 |
| 推播訂閱 | ✅ 可正常啟用 |
| 通知發送 | ✅ 正常運作 |

**前提條件：**
- 有效的 SSL 憑證（Let's Encrypt 免費憑證即可）
- 正確設定 VAPID 金鑰（已有預設值）

---

## 支援的通知類型

| 類型 | 說明 |
|------|------|
| ⏰ 打卡提醒 | 上班時間到時提醒打卡 |
| ⚠️ 漏打卡提醒 | 偵測到漏打卡時通知 |
| 📊 加班超限警示 | 當月加班超過 40/46 小時時通知 |
| ✅ 請假/加班核准 | 申請被核准或拒絕時通知 |
| 📢 系統公告 | 重要系統公告推播 |

---

## 相關檔案

- `/public/sw.js` - Service Worker（處理推播和離線快取）
- `/src/components/ServiceWorkerRegistration.tsx` - SW 註冊元件
- `/src/lib/push-notifications.ts` - 推播通知發送邏輯
- `/src/app/api/push-subscription/route.ts` - 訂閱管理 API
- `/src/app/system-settings/push-notifications/page.tsx` - 設定頁面

---

## 部署後驗證

部署到正式環境後，可透過以下步驟驗證：

1. 開啟 DevTools → Application → Service Workers
2. 確認顯示 `https://your-domain.com/` 且狀態為 `activated`
3. 進入「推播通知設定」頁面
4. 點擊「啟用推播」
5. 應收到測試通知

---

## 故障排除

### 正式環境仍無法啟用

1. **檢查 SSL 憑證**
   ```bash
   curl -I https://your-domain.com
   ```
   確認回應為 200 且無憑證錯誤

2. **檢查 Service Worker**
   - 開啟 DevTools → Application → Service Workers
   - 確認有註冊成功

3. **重新整理快取**
   - 在 Service Workers 區域點擊「Update」
   - 或勾選「Update on reload」後重新整理

4. **檢查 Console 錯誤**
   - 如有 VAPID 相關錯誤，確認環境變數已正確設定
