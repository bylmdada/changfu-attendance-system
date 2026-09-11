# 班表確認機制設定 Bug 稽核（第十二份）

> 產出日期：2026-07-09
> 稽核範圍：確認機制設定（`api/system-settings/schedule-confirm`，三開關：`enabled`／`blockClock`／`enableReminder`）、機制服務層（`src/lib/schedule-confirm-service.ts`，349 行）、確認/發布流程（`api/schedule-confirmation/route.ts`，1013 行）、資料模型（`ScheduleMonthlyRelease`／`ScheduleConfirmation`）。
> 前置文件：第十一份 SC3（失效機制只覆蓋排班管理一條路徑）已詳載，本文件不重複；本文件聚焦**設定驅動的機制本身**。

## 先說做對的部分

- 確認截止時間已用 `getTaiwanMonthEnd`（台灣月底）——第十一份 SC8 所指的伺服器時區問題**已修復**。
- 重確認用 `upsert`（`schedule-confirmation/route.ts:823`）——正確處理了 `@@unique([employeeId, releaseId])` 下的重複確認。
- 重發布有 `version: { increment: 1 }` 並失效全部確認（L903-925）；建立前有 `existingRelease` 判斷防重複發布。
- 設定 PUT 對三個開關都有型別驗證。
- 發布通知（route 端 `SCHEDULE_UPDATE`）已於 2026-07-02 接上落地 DB 的通知系統，鈴鐺可見。

## 問題總表

| # | 問題 | 嚴重度 | 觸發條件 |
|---|------|--------|----------|
| CF1 | 催辦提醒與**異動重確認通知**寫入無人讀取的 `Notification` 表——員工永遠收不到 | **高** | 每次催辦/班表異動失效 |
| CF2 | `blockClock` 的 fail-closed 爆炸半徑：忘記發布 → **全公司員工月初起不能打卡**，且無任何預警配套 | **高** | blockClock 啟用 + 管理員未發布 |
| CF3 | 打卡阻擋以**伺服器時區**取年月——台灣每月 1 日 00:00–08:00 檢查的是**上個月**的發布與確認 | **高** | blockClock 啟用 + 月初早班/夜班 |
| CF4 | 兩套「適用發布」挑選邏輯不一致，且「最後發布勝」會讓全公司發布覆蓋部門發布 | 中 | 部門發布與全公司發布並存 |
| CF5 | 「應確認名單」口徑不一致：催辦端=全體在職員工（含該月無班者），發布通知端=該月有班者 | 中 | 有員工該月無班表 |
| CF6 | 重發布一律 version+1 全員失效——誤按「重新發布」= 全公司重簽 | 中 | 重複按發布 |
| CF7 | 月底最後時刻班表異動 → 確認失效但 deadline 已過 → 員工無法重確認的卡死狀態 | 中 | 月底異動已確認的班表 |
| CF8 | 發布通知與催辦共用 `enableReminder` 開關——擋打卡開、提醒關時員工被擋卻從未被通知 | 低（設定粒度） | 特定開關組合 |
| CF9 | `invalidateConfirmation` 失敗靜默（catch 吞 + 呼叫端不檢查回傳） | 低 | 失效操作異常時 |
| CF10 | `@@unique([yearMonth, department])` 在 SQLite 對 NULL 不去重——併發下可產生兩筆全公司發布 | 低（防禦性） | 併發發布 |

---

## 高嚴重度

### CF1 催辦與異動重確認通知寫入無人讀取的表

**位置**：`src/lib/schedule-confirm-service.ts:153`（發布通知）、`:230`（催辦）、`:331`（異動重確認）——三處都是 `prisma.notification.create`

**已確認的三軌現況**：

| 表/機制 | 讀取端 | 班表確認的通知落在哪 |
|---------|--------|----------------------|
| `InAppNotification` 表 | `/api/in-app-notifications` → **鈴鐺**（第五份整併後的正軌） | route 端發布通知 `SCHEDULE_UPDATE` ✓ |
| 記憶體 Map（realtime） | `/api/notifications`（讀 `notificationSystem`，重啟即失） | — |
| **`Notification` 表** | **全站 grep 零讀取端** | **service 端三種通知全在這** |

**後果**：催辦提醒（`sendReminderToUnconfirmed`）與**異動重確認通知**（`invalidateConfirmation` 內）寫入黑洞。最傷的組合：`blockClock` 啟用時，班表異動 → 確認失效 → 員工打卡被擋「班表已更新，請重新確認」——但那則「請重新確認」的通知**從未送達**，員工只能在被擋當下才發現。

**修正方向**：三處改走已整併的 `sendNotification()`（IN_APP 落地 DB，第五份 #1 已完成的底座）；`Notification` 表若確認無其他用途，標記棄用。

### CF2 blockClock 的 fail-closed 爆炸半徑

**位置**：`schedule-confirm-service.ts:94-100`

```ts
const release = await findApplicablePublishedRelease(yearMonth, employee.department);
if (!release) {
  return { allowed: false, reason: '本月班表尚未發布，請聯繫排班管理員' };
}
```

**現象**：`blockClock` 啟用時，**本月未發布 = 全公司員工不能打卡**。強制流程或許是刻意設計，但配套完全缺失：

- 無「月底前 N 天未發布下月班表」的管理員告警——防呆只在爆炸後才被發現。
- 每月 1 日 00:00 起效（發布通常月底才做，遲一天 = 全員 1 號被擋）。
- 該月**沒有班表的員工**（新人、無排班職位）也被擋——他們連可確認的東西都沒有（見 CF5）。

**修正方向**：(1) 補「未發布告警」cron（月底前 3 天檢查次月發布狀態，通知排班管理員——可掛進第四份 Cron 計畫）；(2) 無班表員工放行（打卡檢查前先查該員工該月是否有任何班表）；(3) 考慮寬限：發布後 N 天才開始擋，而非月份第一秒。

### CF3 打卡阻擋以伺服器時區取年月

**位置**：`schedule-confirm-service.ts:77`

```ts
const yearMonth = `${clockDate.getFullYear()}-${(clockDate.getMonth() + 1)...}`;
```

`getFullYear()/getMonth()` 用**伺服器本地時區**（VPS 為 UTC）——台灣 8/1 00:00–08:00 之間打卡，UTC 還在 7/31，`yearMonth` 算成 `2026-07`，檢查的是**7 月**的發布與確認：

- 8 月班表已發布但員工未確認 → 7 月已確認 → **漏擋**（該擋沒擋）。
- 7 月確認被異動失效、8 月已確認 → **誤擋**（月初早班員工被拒，訊息還叫他確認「本月」班表，他確認了也沒用——8 小時後自動好，靈異現象）。

**修正方向**：改用 `timezone.ts` 的 `getTaiwanYearMonth()`（現成工具，一行）。同檔案其他日期處理建議順路盤一次。

---

## 中嚴重度

### CF4 兩套「適用發布」挑選邏輯不一致 +「最後發布勝」語意

**位置**：service `findApplicablePublishedRelease`（`:25-37`，純 `publishedAt desc`）vs route `pickApplicableRelease`（`:114-147`，publishedAt desc → **部門優先** tie-break → version → id）

兩個問題：

1. **邏輯不同步**：同一員工在「查詢確認狀態」（route）與「打卡阻擋/失效」（service）可能對到不同 release（發布時間相同時，route 取部門那筆、service 隨機）。
2. **「最後發布勝」**：部門 A 先發布、之後全公司發布 → A 部門員工的適用 release 變成全公司那筆——原本對部門 release 的確認**不算數**（不同 releaseId），全部門被要求重新確認；且 `invalidateConfirmation` 依 service 邏輯找 release，若員工確認的是部門 release 而 service 對到全公司 release → `updateMany` 條件不符 → **失效無效**（count 0，靜默）。

**修正方向**：挑選邏輯抽成單一共用函式（建議語意：**部門發布優先於全公司**，同層級才比發布時間）；兩處呼叫同一實作。

### CF5 「應確認名單」口徑不一致

**位置**：service `sendReminderToUnconfirmed`／`getUnconfirmedEmployees`（`:199-205`、`:268-274`）以**全體 isActive 員工**為母體；route 發布通知（L928 後）以**該月有班表的員工**為對象

該月無班的員工：收不到發布通知（route 口徑）、卻出現在未確認名單被催辦（service 口徑）、blockClock 下還必須「確認一份空班表」才能打卡（CF2 連動）。管理端看到的未確認統計也被無班員工灌水。

**修正方向**：統一口徑為「該月有班表的在職員工」——service 端兩個函式的母體查詢加班表存在條件。

### CF6 重發布一律全員失效

**位置**：`schedule-confirmation/route.ts:895-925`

已存在 release 時重按發布 → `version+1` → 該 release 全部確認 `isValid: false`——**不比對班表內容是否真的變了**。誤按一次重新發布 = 全公司重簽一輪（且 CF1 之下員工還收不到重簽通知）。

**修正方向**：低成本版——重發布前彈確認「將使 N 筆已確認失效」（管理端 UX）；進階版——發布時存班表快照雜湊，內容未變的重發布不遞增 version。

### CF7 月底異動的重確認死鎖

**位置**：deadline 檢查 `route.ts:91`（`now > release.deadline` 拒絕確認）＋ 失效機制

月底最後一天（或次月初補改上月班表：調班撤銷、天災假刪除都會回寫歷史班表）→ 確認失效 → 員工要重確認，但 deadline（該月月底）已過 → **確認被拒**，狀態永遠卡在「已失效未重確認」。對上月而言 blockClock 不影響打卡（擋的是當月），但確認統計與法律意義上員工「未確認」一份被改過的班表。

**修正方向**：重確認（已有失效紀錄的 upsert 路徑）豁免 deadline 檢查——deadline 管「首次確認的時限」，不該擋「因異動而起的重確認」。

---

## 低嚴重度

### CF8 發布通知與催辦共用 `enableReminder` 開關

`sendSchedulePublishNotification` 與 `sendReminderToUnconfirmed` 都被 `enableReminder` 閘住（`:139`、`:181`）。組合「enabled ✓ + blockClock ✓ + enableReminder ✗」= 員工被擋打卡、但從發布到催辦**一則通知都沒有**。設定頁也未警示這種危險組合。修正：blockClock 開啟時強制（或強烈建議）reminder 同開；或發布通知不受 reminder 開關控制（它是知情權，不是催辦）。

### CF9 `invalidateConfirmation` 失敗靜默

`:345-348` catch 後回 `{ invalidated: false }`，呼叫端（`api/schedules` 三處）不檢查回傳——失效失敗時班表已改、確認仍有效，無人知道。至少 `logger.error`（有 Sentry）；併發 CF4 修復時一起處理 releaseId 對錯導致的 count 0 靜默。

### CF10 SQLite unique 對 NULL 不去重（防禦性）

`@@unique([yearMonth, department])`——SQLite 中 `department = NULL` 的多筆**不違反** unique。程式層有 `existingRelease` 防重，但併發雙擊發布可繞過 → 同月兩筆全公司 release，兩套挑選邏輯下員工可能對到不同筆。防禦：department 改用哨兵值 `'__ALL__'`（審核流程設定已用此慣例）或發布加交易級防重。

---

## 建議修復順序

1. **CF1 通知改道**（三處改走 `sendNotification()`）——半天，機制的通知閉環立即接通；沒有它，其他修復的體驗都不完整。
2. **CF3 時區一行修**＋ **CF2 的無班員工放行**——半天，堵掉 blockClock 的兩個誤擋源。
3. **CF2 未發布告警 cron**——半天（掛進第四份 Cron 框架）。
4. **CF4 挑選邏輯統一**＋ **CF5 名單口徑統一**——1 天（同一次重構）。
5. **CF6 重發布確認提示 + CF7 重確認豁免 deadline**——各半小時到半天。
6. **CF8–CF10** 見縫插針。

**啟用前 checklist**（若 `blockClock` 尚未在正式環境開啟，開啟前至少完成 1–3 項）：通知閉環（CF1）、時區（CF3）、無班放行與未發布告警（CF2）——否則第一個月初就是客訴高峰。

## 與系列文件的關聯

- CF1 是第五份「通知雙軌」的延伸——實際是**三軌**：`InAppNotification`（正軌）、記憶體 Map（緩衝）、`Notification` 表（黑洞）。建議把 `Notification` 表的棄用納入第五份的整併收尾。
- 失效機制的**覆蓋面**問題（六條班表修改路徑只有一條會失效確認）在第十一份 SC3，與本文件的 CF4/CF9（失效機制的**正確性**）合併修復最省。
- CF2 的告警 cron 併入第四份 Cron 統一管理框架。
