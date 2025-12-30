# 推播通知設定指南

本文件說明系統的 PWA 推播通知功能。

## 功能概述

推播通知讓用戶即使不開啟應用程式，也能即時收到重要通知：

| 通知類型 | 說明 |
|----------|------|
| ⏰ 打卡提醒 | 上班時間到時提醒打卡 |
| ⚠️ 漏打卡提醒 | 偵測到漏打卡時通知 |
| 📊 加班超限警示 | 加班超過 40/46 小時時通知 |
| ✅ 請假/加班核准 | 申請被核准或拒絕時通知 |
| 📢 系統公告 | 重要系統公告推播 |

---

## 前端設定

### 用戶自助設定

用戶可前往 `系統設定 → 推播通知設定` 自行啟用或停用推播：

1. 點擊「啟用推播」按鈕
2. 瀏覽器會詢問是否允許通知權限
3. 選擇「允許」後即完成訂閱
4. 可發送測試通知驗證功能

### 瀏覽器需求

| 瀏覽器 | 支援狀況 |
|--------|----------|
| Chrome | ✅ 完整支援 |
| Firefox | ✅ 完整支援 |
| Edge | ✅ 完整支援 |
| Safari (iOS 16.4+) | ✅ 需安裝 PWA |

---

## 後端 API

### VAPID 金鑰設定

`.env` 需包含以下設定：

```bash
VAPID_PUBLIC_KEY=BBfFGPggYk_u3VQE-jO_1l8WhO3Z2UprKsEhvupcC2EcrgJN9m5y4wW4-sLMJf7Qf5n9b3u4PEEnso6KRmAnZTI
VAPID_PRIVATE_KEY=2jnih7vSYAZSdX1bA6N9dH4KEYWu93wHcjBIzpXnJus
VAPID_SUBJECT=mailto:admin@changfu.org
```

### API 端點

#### GET `/api/push-subscription`
取得 VAPID 公鑰和訂閱狀態。

#### POST `/api/push-subscription`
儲存推播訂閱。

```json
{
  "subscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } },
  "sendTest": true
}
```

#### DELETE `/api/push-subscription`
取消推播訂閱。

---

## 程式碼整合

### 發送推播通知

```typescript
import { sendPushNotification } from '@/lib/push-notifications';

// 發送給單一員工
await sendPushNotification(employeeId, {
  type: 'ATTENDANCE_REMINDER',
  title: '⏰ 打卡提醒',
  body: '別忘了打卡哦！',
  data: { url: '/attendance' }
});

// 批量發送
import { sendBulkPushNotification } from '@/lib/push-notifications';
await sendBulkPushNotification([1, 2, 3], payload);
```

### 預建函數

| 函數 | 說明 |
|------|------|
| `sendAttendanceReminder(employeeId)` | 打卡提醒 |
| `sendMissedClockReminder(employeeId, 'IN'|'OUT')` | 漏打卡提醒 |
| `sendOvertimeWarningPush(employeeId, hours, 'WARNING'|'CRITICAL')` | 加班警示 |
| `sendLeaveApprovalPush(employeeId, approved, leaveType, dates)` | 請假核准 |
| `sendTestPush(employeeId)` | 測試通知 |

---

## Service Worker 設定

推播通知由 `public/sw.js` 的 Service Worker 處理：

- 支援不同通知類型的操作按鈕
- 點擊通知可導向對應頁面
- 自動聚焦已開啟的視窗

---

## 資料庫結構

推播訂閱資訊儲存於 `NotificationSettings` 表：

| 欄位 | 類型 | 說明 |
|------|------|------|
| `pushEnabled` | Boolean | 是否啟用推播 |
| `pushEndpoint` | String? | 推播服務端點 |
| `pushP256dh` | String? | 加密公鑰 |
| `pushAuth` | String? | 認證金鑰 |

---

## 故障排除

### 推播沒有收到

1. 確認瀏覽器通知權限為「允許」
2. 確認 `.env` 中 VAPID 金鑰正確
3. 確認 Service Worker 已註冊（開發者工具 → Application → Service Workers）
4. iOS 用戶需將網站加入主畫面（安裝 PWA）

### 產生新的 VAPID 金鑰

```bash
npx web-push generate-vapid-keys --json
```
