# P1 共用元件設計：批次工作流強化 + 通知中心（第三份）

> 產出日期：2026-07-02
> 前置文件：[SYSTEM_OPTIMIZATION_ROADMAP.md](./SYSTEM_OPTIMIZATION_ROADMAP.md)、[P0_IMPLEMENTATION_PLAN.md](./P0_IMPLEMENTATION_PLAN.md)
> 範圍：P1 中影響面最大的兩個共用元件。經逐檔核實，**兩者的後端基礎都已存在**，實際工作量比路線圖初估低。
> 執行狀態：第三批已實作（2026-07-02）：通知鈴鐺 + 全部通知頁、`BatchApproveBar` 預覽確認 + 核准備註 + 三個既有批次頁摘要接線已完成；第二批補上 realtime 通知落地 DB、通知導頁優化、審核儀表板批次操作與 `useRowSelection`；第三批補上薪資產生 `PAYROLL_READY` 通知。

## 現況核實摘要（與路線圖初版的差異）

| 路線圖原判斷 | 核實後現況 | 修正後的工作 |
|--------------|------------|--------------|
| 「缺統一批次工作流元件」 | `src/components/BatchApproveBar.tsx`（242 行）已存在，請假/加班/補打卡/調班 4 頁使用；通用 `/api/batch-approve`（636 行）支援 `resourceType`/`ids`/`action`/`notes` | 強化既有元件，不重寫 |
| 「新增通知中心」 | 後端完整：`InAppNotification` 模型 + `/api/in-app-notifications`（GET 含 unreadOnly/limit/offset/未讀數；POST 支援標記已讀/刪除）；`src/lib/email.ts` 的 `sendNotification()` 已支援 EMAIL/IN_APP/BOTH 三渠道 | 純前端 UI + 事件接線 |

---

## 一、批次工作流強化（BatchApproveBar v2）

### 1.1 現況

- **元件**：`src/components/BatchApproveBar.tsx`，props 含 `selectedIds`、`apiEndpoint`、`onSuccess`、`onClear`、`onSelectionChange`、`itemName`、`requireRejectReason`。
- **使用頁面**：`leave-management`（`page.tsx:1824`）、`overtime-management`、`missed-clock`、`shift-exchange`。
- **既有能力**：批次核准/拒絕；拒絕時可填原因（`remarks`，見元件 L92）。
- **缺口**：
  1. 按下核准前**看不到選了哪些項目**（只顯示筆數），易誤批。已於第一批完成。
  2. **核准**時無備註欄（只有拒絕有）。已於第一批完成。
  3. 審核儀表板（`approval-dashboard`）未接入批次操作。已於第二批完成保守版。
  4. 各頁自行維護 checkbox 選取邏輯（`selectedIds` state + 全選判斷），程式重複。第二批已新增 hook 並先接入審核儀表板；其他頁面待後續小步替換。

### 1.2 設計

#### 變更 A：確認前預覽面板（核心）

`BatchApproveBar` 新增選填 prop：

```ts
interface BatchApproveBarProps {
  // ...既有 props 不動，維持向後相容
  /** 供預覽面板顯示的項目摘要；不傳則維持現行「僅顯示筆數」行為 */
  itemSummaries?: { id: number; label: string; sublabel?: string }[];
  /** 核准是否顯示備註欄，預設 false（維持現行為） */
  allowApproveNote?: boolean;
}
```

- 點「批次核准/拒絕」→ 先彈確認 modal，列出 `itemSummaries` 中被選取的項目（`label` 如「王小明 特休 7/10–7/12」），每列附移除鈕可當場剔除。
- modal 內含備註欄：拒絕時必填（沿用 `requireRejectReason`）、核准時依 `allowApproveNote` 顯示選填欄，送出時放入既有 `notes` 欄位（`/api/batch-approve` 已支援，`leave-requests/batch` 若不支援則補收此欄位）。
- 各頁只需多組一個 `itemSummaries` 陣列（資料已在頁面 state 中，一行 `map` 的事）。

#### 變更 B：選取邏輯抽 hook

新增 `src/hooks/useRowSelection.ts`（約 30 行）：

```ts
const { selectedIds, toggle, toggleAll, clear, isSelected, allSelected } =
  useRowSelection(reviewableRequests.map(r => r.id));
```

4 個頁面替換各自的 `selectedIds` useState 與全選判斷。純重構，行為不變。

#### 變更 C：擴至審核儀表板

`approval-dashboard/page.tsx` 的待審列表加 checkbox 欄 + `BatchApproveBar`，`apiEndpoint` 指向 `/api/batch-approve`（resourceType 依列表項目型別帶入）。儀表板是跨類型列表，第一版**僅允許同類型項目一起批次**（混選時停用按鈕並提示），避免後端一次交易跨多資源的複雜度。

**跳過**：批次轉會/批次 CC（使用頻率待驗證）、跨類型混合批次、儲存常用批次條件。需要時再加。

### 1.3 影響檔案

| 檔案 | 變更 |
|------|------|
| `src/components/BatchApproveBar.tsx` | 加預覽 modal、核准備註、`itemSummaries` prop |
| `src/hooks/useRowSelection.ts` | 新增 |
| `leave-management`、`overtime-management`、`missed-clock`、`shift-exchange` 各 `page.tsx` | 傳入 `itemSummaries`、換用 hook |
| `src/app/approval-dashboard/page.tsx` | 加 checkbox 欄 + BatchApproveBar |
| `src/app/api/leave-requests/batch/route.ts` | 確認/補收核准 `notes` 欄位 |

第一批實際完成：

- `src/components/BatchApproveBar.tsx`：新增 `itemSummaries`、`allowApproveNote`，確認 modal 可預覽並剔除誤選項目。
- `src/app/leave-management/page.tsx`、`src/app/overtime-management/page.tsx`、`src/app/missed-clock/page.tsx`：傳入批次摘要並開啟核准備註。
- 暫緩 `useRowSelection` 與 `approval-dashboard` 批次操作，避免一次改動跨頁選取模型。

第二批實際完成：

- `src/hooks/useRowSelection.ts`：新增共用列選取 hook。
- `src/app/approval-dashboard/page.tsx`：待審列表新增本頁全選與單筆勾選，接入 `BatchApproveBar`；混選不同申請類別時停用送出並提示。
- 儀表板批次支援既有 API 已覆蓋的類型：請假、加班、補打卡、調班/換班；其他類型仍保留單筆審核。

### 1.4 驗證

- 請假管理選 3 筆 → 點批次核准 → modal 列出 3 筆摘要 → 剔除 1 筆 → 送出 → 僅 2 筆變核准，備註寫入審核紀錄。
- 不傳 `itemSummaries` 的頁面行為與現行完全相同（向後相容）。
- 審核儀表板混選請假 + 加班 → 批次按鈕停用並提示「請選擇同類型項目」。

### 1.5 預估：3–4 天

---

## 二、通知中心（NotificationCenter)

### 2.1 現況

- **後端已完整，前端零消費**：
  - 模型 `InAppNotification`（employeeId/type/title/message/data/isRead，三個索引齊全）。
  - API `/api/in-app-notifications`：GET（`unreadOnly`、`limit`、`offset`，回傳含未讀數）、POST（`markAsRead`、標記全部已讀、刪除）。
  - 建立端：`src/lib/email.ts` 的 `sendNotification()`（channel 支援 `EMAIL | IN_APP | BOTH`），既有 helper：`notifyLeaveApproval`、`notifyOvertimeApproval`、`notifyShiftApproval`、`notifyAnnualLeaveExpiry`（含階段提醒）。
- **缺口**：
  1. `SystemNavbar.tsx` 無鈴鐺入口，使用者永遠看不到這些通知。
  2. 事件覆蓋窄：只有請假/加班/調班核准與特休到期；`realtime-notifications.ts` 定義的 PAYROLL_READY、SECURITY_ALERT、FREEZE_REMINDER、APPROVAL_REMINDER 等型別**無人觸發**。
  3. 管理端無「X 筆逾期未審」類主動提醒。

### 2.2 設計

#### 變更 A：鈴鐺 + 通知面板

新增 `src/components/NotificationBell.tsx`，掛進 `SystemNavbar.tsx`：

- 鈴鐺 icon + 未讀數 badge（>99 顯示 99+）。
- 未讀數更新：60 秒輪詢 `GET /api/in-app-notifications?unreadOnly=true&limit=1`（回應已含未讀數）。`// ponytail: 輪詢即可，SSE/WebSocket 等有即時性需求再上`
- 點鈴鐺開下拉面板（手機改全寬 drawer）：
  - 最近 20 筆，未讀底色標示，顯示 title/message/相對時間。
  - 點單筆 → 標記已讀 + 依 `type` 導向對應頁面（型別→路徑對照表放元件內常數）。
  - 「全部標為已讀」按鈕（API 已支援）。
  - 底部「查看全部」→ 新頁 `src/app/notifications/page.tsx`：分頁列表 + 已讀/未讀篩選，同一支 API 的 `offset` 分頁。

第一批實際完成：

- `src/components/NotificationBell.tsx`：鈴鐺、未讀 badge、60 秒輪詢、最近 20 筆、單筆標已讀、全部已讀、類型導頁。
- `src/components/SystemNavbar.tsx`：掛入通知鈴鐺。
- `src/app/notifications/page.tsx`：全部通知頁，支援全部/未讀篩選、分頁、單筆已讀、刪除。

#### 變更 B：事件接線（沿用 `sendNotification()`，逐點呼叫）

| 事件 | 觸發點 | 收件人 | 優先序 |
|------|--------|--------|--------|
| 有新申請待你審核 | 各申請 create 後（approval-instance 建立處） | 該關卡審核人 | 1 |
| 補打卡/購買申請/扶養人審核結果 | 各自 review 路由 | 申請人 | 1 |
| 薪資單已產生（PAYROLL_READY） | `api/payroll/generate` 成功後 | 當月有薪資單的員工 | 2 |
| 考勤凍結前提醒（FREEZE_REMINDER） | 既有 `ApprovalFreezeReminder` 排程處 | 有未結申請的員工 | 2 |
| 逾期未審提醒（APPROVAL_REMINDER） | 既有 `api/cron/process-overdue` | 逾期關卡審核人 | 2 |
| 安全事件（SECURITY_ALERT） | P0 #5 已規劃（`logSecurityEvent`） | 管理員 | 已在 P0 |
| 班表已發布/待確認 | `ScheduleMonthlyRelease` 建立處 | 該月有班員工 | 3 |

批次收件人（如薪資單）用迴圈呼叫即可；SQLite 單機、幾百員工量級不需要佇列。`// ponytail: 同步迴圈發送，量級破千再考慮 job queue`

> 後續核實補充（見第五份文件）：`realtime-notifications.ts` 的通知只存**記憶體 Map**，不寫 `InAppNotification` 表——`approval-notifications.ts`（notifyReviewers/notifyApplicant）與 `approval-scheduler.ts`（逾期提醒）已在呼叫它，但鈴鐺讀的 DB API 看不到這些通知。因此上表「有新申請待你審核」「逾期未審提醒」實際上是**已接線但落錯地方**，整併方案見第五份文件第一項；整併完成後這兩列自動生效。

第二批實際完成：

- `src/lib/realtime-notifications.ts`：`IN_APP` channel 會同步寫入 `InAppNotification`，讓既有 `notifyReviewers`、`notifyApplicant`、逾期提醒、凍結提醒能被通知鈴鐺讀到。
- `src/lib/__tests__/realtime-notifications.test.ts`：新增 guard 測試，防止 realtime 通知再次只留在記憶體。
- `src/components/NotificationBell.tsx`：補 `APPROVAL`、`APPROVAL_RESULT` 導頁；審核結果依 `requestType/requestId` 導到對應功能頁。

第三批實際完成：

- `src/app/api/payroll/generate/route.ts`：每筆薪資記錄成功產生後，發送 `PAYROLL_READY` 系統內通知給該員工；通知失敗僅記錄 warning，不影響薪資產生結果。
- `src/app/api/payroll/generate/__tests__/route.test.ts`：新增 guard 測試，確認薪資產生成功會送出 `PAYROLL_READY`。

#### 變更 C：型別常數收斂

`email.ts` 的 `NotificationType` 與 `realtime-notifications.ts` 的型別枚舉並存——接線時統一以 `email.ts` 為準（它才有實際建立紀錄的程式），`realtime-notifications.ts` 缺的型別字串補進 `NotificationType`，避免兩套定義漂移。

**跳過**：員工通知偏好設定 UI（`NotificationSettings` 模型已有，屬 P1 另案）、勿擾時段、推播渠道整合（Web Push 已有訂閱端點，接線後續再做）、通知保留期清理（併入 P0 #2 之後的資料保留政策）。

### 2.3 影響檔案

| 檔案 | 變更 |
|------|------|
| `src/components/NotificationBell.tsx` | 新增（鈴鐺 + 面板） |
| `src/components/SystemNavbar.tsx` | 掛入鈴鐺 |
| `src/app/notifications/page.tsx` | 新增（全部通知頁） |
| `src/lib/email.ts` | `NotificationType` 補型別；視需要加 helper |
| 各觸發點路由（見 2.2-B 表） | 每處 3–5 行 `sendNotification()` 呼叫 |

### 2.4 驗證

- 核准一筆請假 → 申請人鈴鐺 60 秒內出現未讀 badge，點開見通知，點通知跳轉請假頁且變已讀。
- 「全部標為已讀」後 badge 歸零。
- 產生薪資 → 在職員工各收到一筆 PAYROLL_READY。
- 手機視窗寬度下面板為全寬 drawer、可操作。

### 2.5 預估：4–5 天（UI 2 天 + 接線 2 天 + 驗證 1 天）

---

## 三、實施順序建議

1. **通知中心變更 A（鈴鐺 + 面板）先做**——後端零改動、當天可見成果，且 P0 #5（安全告警）與 #4（薪資日誌）發的通知立即有地方呈現。
2. 批次工作流變更 A/B（預覽 + hook）。
3. 通知事件接線（優先序 1 → 2 → 3）。
4. 批次工作流變更 C（審核儀表板）。

兩元件合計約 **7–9 天**，可與 P0 並行（無檔案衝突，除 `email.ts` 輕微交集）。

## 下一份文件

建議第四份：「P1 管理模組缺口實施計畫」——請假餘額警示、排班衝突提示、離職檢查清單（`HandoverItem` 模型已存在）、Cron 統一管理。
