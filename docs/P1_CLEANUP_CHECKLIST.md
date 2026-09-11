# P1 收尾清單（第五份）

> 產出日期：2026-07-02
> 前置文件：[SYSTEM_OPTIMIZATION_ROADMAP.md](./SYSTEM_OPTIMIZATION_ROADMAP.md)、[P1_SHARED_COMPONENTS_DESIGN.md](./P1_SHARED_COMPONENTS_DESIGN.md)、[P1_ADMIN_MODULES_PLAN.md](./P1_ADMIN_MODULES_PLAN.md)
> 範圍：P1 剩餘小顆粒項目。核實過程發現一個**架構級問題**（通知雙軌分裂），列為本份第一項。
> 執行狀態：#1 已核實完成；#2 已補班表發布 `SCHEDULE_UPDATE` 站內通知（2026-07-02）。PasswordException 管理 UI 已存在於密碼政策頁，不另開重複頁。

## 總覽

| # | 項目 | 預估 | 相依 |
|---|------|------|------|
| 1 | 通知雙軌整併（架構修正） | 已完成 | 建議先於第三份的鈴鐺上線 |
| 2 | 缺失通知事件接線 | 部分完成 | #1 |
| 3 | 通知設定測試按鈕 | 0.5 天 | 無 |
| 4 | PasswordException 管理 UI | 1 天 | 無 |
| 5 | 強制 2FA enforcement | 1 天 | 無 |
| 6 | 敏感資料存取日誌 | 0.5–1 天 | 無 |
| 7 | LoginLog 保留期限 | 0.5 天 | 可併入第四份 Cron 項 |

合計約 **5.5–7 天**。

---

## 1. 通知雙軌整併（本次核實的最重要發現）

### 現況

系統存在**兩套互不相通的站內通知**：

| | A 軌：`src/lib/email.ts` | B 軌：`src/lib/realtime-notifications.ts` |
|---|---|---|
| 儲存 | DB `InAppNotification` 表 | **記憶體 Map**（`realtime-notifications.ts:512-527`），重啟即失 |
| 讀取端 | `/api/in-app-notifications`（第三份的鈴鐺讀這裡） | 只有同檔內的 `getUserNotifications()`，無 API 消費 |
| 目前使用者 | `notifyLeaveApproval` 等 4 個 helper | `approval-notifications.ts`（notifyReviewers L139 / notifyApplicant L199）、`approval-scheduler.ts`（逾期升級與日報 L283） |

**後果**：「有新申請待審核」「逾期未審提醒」「審核結果」這些最重要的通知其實**一直在發**，但落在記憶體 Map 裡——沒有任何 UI 讀它、伺服器重啟就消失。第三份文件接線表中的這兩列不是「未接線」，而是**接錯地方**。

### 具體變更（ponytail：單點落地，不重寫呼叫方）

1. 修改 `realtime-notifications.ts` 的 `createNotification()`：當 channels 含 `IN_APP` 時，將通知同步寫入 `InAppNotification` 表（targetUsers 逐人建立；targetRoles 先查該角色員工再建立）。**所有既有呼叫方（審核通知、逾期提醒、日報）零改動自動受益**。
2. 記憶體 Map 保留現狀不動（未來若做 SSE 即時推送還用得到），加註：`// ponytail: Map 僅作即時推送緩衝，持久化以 InAppNotification 為準`。
3. `type` 字串直接沿用 B 軌已定義的枚舉（APPROVAL、APPROVAL_REMINDER 等），鈴鐺的型別→路徑對照表涵蓋這些值——此即第三份「變更 C 型別收斂」的落地方式。

已核實完成（2026-07-02）：`realtime-notifications.ts` 的 `IN_APP` 已寫入 `InAppNotification`，通知鈴鐺可讀；保留記憶體 Map 作即時緩衝。

### 驗證

- 提交一筆請假 → 審核人的 `InAppNotification` 表出現 APPROVAL 紀錄（鈴鐺可見）。
- 重啟 dev server → 通知仍在（DB 持久化）。

---

## 2. 缺失通知事件接線

### 現況

整併（#1）後，第三份接線表中「已接線」的項目自動生效，**真正缺觸發點**的剩：

| 事件 | 現況 | 接線點 |
|------|------|--------|
| 薪資單已產生（PAYROLL_READY） | 完全未觸發 | `api/payroll/generate` 成功後（與 P0 #4 薪資日誌同檔，一起做） |
| 考勤凍結前提醒（FREEZE_REMINDER） | `ApprovalFreezeReminder` 模型僅在 `api/system-settings/approval-workflows/route.ts` 被寫入設定，**無排程消費者** | 實作時先確認是否真無消費者；若無，掛進 `process-overdue` cron 順路檢查發送 |
| 班表已發布（SCHEDULE_UPDATE） | 未觸發 | `api/schedule-confirmation/route.ts` 的 `scheduleMonthlyRelease.create` 後 |

各接線點 3–5 行 `sendNotification()` 呼叫（走 B 軌入口即可，#1 已讓它落地）。

### 驗證

- 產生薪資 → 在職員工鈴鐺出現 PAYROLL_READY。
- 發布月班表 → 該月有班員工收到通知。

已完成（2026-07-02）：`PAYROLL_READY` 已在薪資產生後發送；`SCHEDULE_UPDATE` 已在班表發布後發送，對象限縮為該月有班表的在職員工。

---

## 3. 通知設定測試按鈕

### 現況

- 有測試功能：SMTP（`api/system-settings/smtp/test`）、推播（`system-settings/push-notifications/page.tsx` 已含測試）。
- 無測試功能：`system-settings/email-notification`、`system-settings/notification-config` 兩頁。

### 具體變更

兩頁各加「傳送測試」按鈕：email-notification 呼叫新增的 `api/system-settings/email-notification/test`（對當前登入者信箱發一封測試信，內部沿用 SMTP test 的寄送邏輯）；notification-config 直接對當前登入者發一筆測試站內通知（走 #1 整併後的 `sendNotification`，不需新 API 也可，用既有通知建立端點）。

### 驗證

- 點測試按鈕 → 收到測試信/鈴鐺出現測試通知；SMTP 未設定時顯示明確錯誤。

---

## 4. PasswordException 管理 UI

### 現況

- API 完整：`api/system-settings/password-exceptions/route.ts` 有 GET（L57）/POST（L106）/DELETE（L289）。
- `src/app/system-settings/` 下**無對應頁面資料夾**（32 個設定頁中獨缺此項）。

### 具體變更

新增 `src/app/system-settings/password-exceptions/page.tsx`：例外清單表格 + 新增表單（選員工 + 例外原因）+ 刪除按鈕，版型仿既有設定頁（如 `password-policy`）；設定首頁 `system-settings/page.tsx` 加入口卡片。選員工處直接用 P0 #3 的 `EmployeeSelect` 元件。

核實修正（2026-07-02）：PasswordException 管理 UI 已存在於 `system-settings/password-policy` 的「例外設定」分頁，且已接 `api/system-settings/password-exceptions` 的 GET/POST/DELETE；不另開重複頁。

### 驗證

- 新增一筆例外 → 該員工登入不受密碼政策強制（依既有 API 行為）；刪除後恢復。

---

## 5. 強制 2FA enforcement

### 現況

- 2FA 基礎完整：TOTP（`api/auth/2fa/setup|verify|disable|status` + `verify-2fa`，登入流程已檢查 `user.twoFactorEnabled`，含 replay 防護）與 WebAuthn 並存；設定頁 `system-settings/2fa/page.tsx` 介面已有 `required: boolean` 欄位（L18）。
- **但全 src 無任何 enforcement**：`required` 設定存了沒人讀，登入只看個人開關。

### 具體變更

1. 登入成功（密碼正確、個人未啟用 2FA）時讀取系統 2FA 設定：若 `required` 為真且使用者角色屬目標範圍（管理員/HR，依設定頁既有欄位），回應帶 `requiresTwoFactorSetup: true`。
2. 前端收到此旗標 → 導向 2FA 設定頁並鎖定導覽（完成設定前只能登出或設定），不做寬限期。`// ponytail: 硬導向即可，寬限期等有人抱怨再加`
3. 完成 setup 後放行，行為與一般登入相同。

### 驗證

- 開啟強制 + 管理員帳號未設 2FA → 登入後被導向設定頁，無法進其他頁面；完成設定後正常。
- 一般員工（非目標角色）不受影響。

---

## 6. 敏感資料存取日誌

### 現況

- `AuditAction.VIEW` 已定義於 `src/lib/audit.ts`，但薪資查詢 API（`api/payroll/route.ts`）無任何 `logAudit` 呼叫——誰查過誰的薪資無從追溯。

### 具體變更（ponytail：沿用 AuditLog，不建 DataAccessLog 新模型）

1. 在薪資相關 GET 加 `logAudit({ action: AuditAction.VIEW, targetType: PAYROLL_RECORD, ... })`，**僅記錄「查詢他人資料」**（管理員視角），本人查自己不記——避免日誌噪音淹沒有效訊號。範圍：`api/payroll`（管理員列表）、`payroll/payslip-download`、`salary-management` 相關查詢。
2. description 記明查詢對象與月份（如「查看 王XX 2026-06 薪資」）。

### 驗證

- 管理員查他人薪資 → AuditLog 一筆 VIEW；員工查自己薪資 → 無紀錄。

---

## 7. LoginLog 保留期限

### 現況

- `LoginLog` 無保留設定、無清理排程，無限增長（SQLite 檔案隨之膨脹）。

### 具體變更

保留天數作為常數（180 天）寫進第四份的 cron 清理（`process-overdue` 順路 `deleteMany` 過期紀錄），與 `CronRunLog` 90 天清理同一處。**不做設定 UI**——沒人會調這個值，要調改常數即可。登入日誌頁若需要匯出，沿用 roadmap 2.2-3 共用匯出元件（P2）。

### 驗證

- 塞一筆 200 天前的假紀錄 → cron 跑後消失；179 天的保留。

---

## 實施順序建議

1. **#1 通知整併最優先**——它是第三份鈴鐺、第四份 cron 告警、P0 安全告警的共同底座；不整併，鈴鐺上線後會漏掉最重要的審核通知。
2. #2 事件接線緊隨（同脈絡）。
3. #4、#5（安全類，彼此獨立）。
4. #3、#6、#7 見縫插針。

## 路線圖同步修正

本次已回寫第一份路線圖與第三份設計文件：3.5-1 改為「通知雙軌分裂」（原判斷「未整合」低估了問題——是接了但落在記憶體）；4.4-3 的 2FA 改為「基礎完整、缺 enforcement」。

## 系列文件狀態

| 份 | 文件 | 內容 |
|----|------|------|
| 1 | `SYSTEM_OPTIMIZATION_ROADMAP.md` | 全站優化總覽 + P0–P3 路線圖 |
| 2 | `P0_IMPLEMENTATION_PLAN.md` | P0 七項實施計畫（備份已完成） |
| 3 | `P1_SHARED_COMPONENTS_DESIGN.md` | 批次工作流強化 + 通知中心 |
| 4 | `P1_ADMIN_MODULES_PLAN.md` | 餘額警示、排班覆蓋、離職補強、Cron 管理 |
| 5 | 本文件 | 通知整併 + P1 小顆粒收尾 |

P1 至此已全數拆解為可執行計畫（第 3–5 份合計約 19–25 天）。P2 項目建議實際動工消化 P0/P1 後再展開。
