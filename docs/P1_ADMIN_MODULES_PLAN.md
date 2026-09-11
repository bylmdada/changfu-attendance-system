# P1 管理模組缺口實施計畫（第四份）

> 產出日期：2026-07-02
> 前置文件：[SYSTEM_OPTIMIZATION_ROADMAP.md](./SYSTEM_OPTIMIZATION_ROADMAP.md)、[P0_IMPLEMENTATION_PLAN.md](./P0_IMPLEMENTATION_PLAN.md)、[P1_SHARED_COMPONENTS_DESIGN.md](./P1_SHARED_COMPONENTS_DESIGN.md)
> 範圍：P1 管理模組四項——請假餘額警示、排班衝突提示、離職流程補強、Cron 統一管理。均已逐檔核實現況。
> 執行狀態：前兩項已實作（2026-07-02）：請假管理 API 回傳特休餘額，管理端列表與批次審核預覽顯示剩餘、超額與將過期提示；批次建立班表新增 dry-run 覆蓋確認，確認後才覆蓋既有班表。

## 總覽

| # | 項目 | 預估 | 相依 |
|---|------|------|------|
| 1 | 請假餘額警示（管理端） | 已完成 | 無 |
| 2 | 排班衝突覆蓋確認 | 已完成 | 無 |
| 3 | 離職流程補強 | 2 天 | 無 |
| 4 | Cron 統一管理 | 2 天 | 告警呈現依賴通知中心（第三份），非硬相依 |

合計約 **6–8 天**，四項彼此獨立可並行。

---

## 一、請假餘額警示（管理端審核畫面）

### 現況核實

- **餘額機制本身健全**：核准、撤銷、作廢都會正確增減 `AnnualLeave.usedDays`（`api/leave-requests/[id]/route.ts:207`、`batch/route.ts:134`、`cancel/route.ts:50`、`void/route.ts:91`，含通用 `batch-approve/route.ts:303`）。
- **員工端到期提醒已存在**：`sendAnnualLeaveExpiryReminders()` + 階段提醒 + `LeaveExpiryReminderLog` 防重複。
- **缺口在管理端呈現**：`leave-management/page.tsx` 全頁無任何餘額顯示（grep「餘額/remaining」0 筆）——審核人看不到申請人剩幾天特休，超額申請無警示。

### 具體變更

1. `api/leave-requests` GET（管理視角）回應每筆附申請人當年度 `AnnualLeave` 的 `remainingDays`/`expiryDate`（一次 `findMany` 用 employeeId+year 組 map，避免 N+1）。已完成。
2. `leave-management/page.tsx` 審核列表顯示「特休剩餘 X 天」；當申請天數 > 剩餘天數時紅字警示「超出餘額 X 天」——**只警示不阻擋**，是否核准由管理員判斷（業務上可能有補登情境）。已完成。
3. 申請人餘額 ≤ 0 或 30 天內到期且有剩時，姓名旁加 badge（「特休已用盡」/「特休將過期」）。已完成。
4. 順手把同樣的餘額資訊加進第三份文件的 `BatchApproveBar` 預覽面板 `sublabel`（一行字串的事）。已完成。

### 驗證

- 建一筆超出餘額的特休申請 → 管理端列表與詳情出現紅字警示；核准後餘額變負值時 badge 顯示「已用盡」。
- 非特休假別（事假/病假）不顯示特休警示。

---

## 二、排班衝突覆蓋確認

### 現況核實

- 批次建班 API 對已有班表的日期**直接 `updateMany` 靜默覆蓋**（`api/schedules/route.ts:576–640`），回應含 `createdCount`/`updatedCount`。
- 前端送出前無任何提示，送出後也未呈現「覆蓋了幾筆」——管理員可能在不知情下改掉別人排好的班。

### 具體變更

1. API 加 `dryRun: true` 參數：走同一段查詢邏輯但不寫入，回傳將新增筆數、將覆蓋明細（員工、日期、舊班別 → 新班別）。查詢程式碼已存在（L576–594 的 existing 檢查），只需提前 return。
2. `schedule-management/page.tsx` 批次建班送出前先呼叫 dryRun：
   - `updatedCount === 0` → 直接送出，不多一步。
   - `updatedCount > 0` → 彈確認 modal 列出覆蓋清單，確認後才真正送出。
3. 送出後 toast 顯示「新增 X 筆、覆蓋 Y 筆」（回應已有數字，純呈現）。

已完成（2026-07-02）：`api/schedules` 支援 `dryRun` 預覽且不寫入、不失效確認狀態；建立班表 UI 於多員工或多日期送出前檢查覆蓋，僅在會覆蓋時顯示確認框。

**跳過**：工時超標警告（roadmap 另列，需先定義規則來源，另案）。

### 驗證

- 對已排班日期批次建班 → 出現覆蓋確認 modal，列出舊→新班別；取消後資料庫無變更。
- 全新日期批次建班 → 無多餘確認步驟，行為與現行相同。

---

## 三、離職流程補強

### 現況核實（修正路線圖初判）

- **交接清單遠比初判完整**：`HandoverItem` 模型（category：EQUIPMENT/DATA/PERMISSION/DOCUMENT/OTHER、完成人/時間追蹤）、`/api/resignation/handover` API、`resignation-management/page.tsx` 的交接項目顯示與更新 UI **都已存在**；狀態流 PENDING → APPROVED → IN_HANDOVER → COMPLETED 完整，且「完成離職」已強制檢查未完成交接項（`api/resignation/[id]/route.ts:258–265`）。
- **真正缺口**：
  1. 交接項目須經 `/api/resignation/handover` **手動逐筆建立**（`handover/route.ts:168`），無預設模板——實務上容易漏建，強制檢查形同虛設（0 項也算全完成）。
  2. 完成離職**不會停用帳號**（該路由無任何 Employee/User 停用邏輯）——離職員工仍可登入。
  3. 薪資結清（`/api/resignation-settlement` 含 preview 已存在）未納入完成離職前的檢查。

### 具體變更

1. **預設交接清單**：核准離職（`action === 'approve'`）時，同交易內自動建立預設 `HandoverItem`（常數陣列，約 6 項：門禁卡/識別證 EQUIPMENT、電腦與周邊 EQUIPMENT、系統帳號權限 PERMISSION、工作文件移交 DOCUMENT、業務聯絡人交接 OTHER、公司財物歸還 EQUIPMENT）。管理頁既有 UI 可直接增刪改，模板只是起點。
2. **完成即停用**：`action === 'complete'` 交易內將該員工帳號停用（沿用 Employee/User 既有的狀態欄位，實作時確認欄位名），並 `logAudit`（`AuditAction.UPDATE`，description「離職完成自動停用帳號」）。若 `actualDate` 晚於今日，改由 `process-overdue` cron 順路處理到期停用。`// ponytail: 多數離職完成即當日，cron 兜底即可，不做獨立排程`
3. **結清檢查**：complete 前查 `ResignationSettlement` 是否存在且已確認——不存在時**警告但不阻擋**（回應帶 warning，前端確認框顯示「尚未建立離職結清紀錄，確定完成？」）。結清規則因人而異，硬擋會卡住例外情境。

### 驗證

- 核准一筆離職 → 交接清單自動出現 6 個預設項目。
- 交接全完成 + 完成離職 → 該員工登入被拒；AuditLog 有停用紀錄。
- 無結清紀錄時完成離職 → 出現警告確認框，確認後仍可完成。

---

## 四、Cron 統一管理

### 現況核實

- 共 **5 個 cron 端點**（非路線圖所寫 3 個）：`overtime-warning`、`process-overdue`、`property-maintenance/daily-reminder`、`property-maintenance/generate-tasks`、`property-maintenance/supervisor-digest`。均以 `CRON_SECRET` header 驗證、由 VPS crontab 觸發。
- 執行紀錄各自為政：property 系列有 `PropertyMaintenanceReminderLog`、特休提醒有 `LeaveExpiryReminderLog`，但 `overtime-warning` 等**無任何執行紀錄**；全部**無失敗告警**、無手動觸發入口、crontab 排程未見文件化。

### 具體變更（ponytail：紀錄 + 告警 + 手動觸發，不做調度系統）

1. 新增模型：

   ```prisma
   model CronRunLog {
     id         Int      @id @default(autoincrement())
     jobName    String   @map("job_name")
     startedAt  DateTime @map("started_at")
     finishedAt DateTime @map("finished_at")
     success    Boolean
     message    String?  // 摘要或錯誤訊息
     @@index([jobName, startedAt])
     @@map("cron_run_logs")
   }
   ```

2. 共用 wrapper `src/lib/cron-logging.ts`（約 30 行）：`withCronRunLog(jobName, handler)` 記錄起訖與結果；失敗時呼叫 `sendNotification()` 通知管理員（型別 SYSTEM_ALERT，通知呈現靠第三份文件的鈴鐺）。5 個路由各包一層。既有的 ReminderLog 不動（它們記的是業務明細，層次不同）。
3. `SystemMonitoringDashboard` 加「排程任務」區塊：列 5 個 job 的最近執行時間/結果/耗時（讀 `CronRunLog` 各 jobName 最新一筆），每列附「手動觸發」按鈕（管理員身分 POST 對應端點，路由放行 admin session 或 CRON_SECRET 二擇一驗證）。與 P0 #7（監控接真實數據）同一儀表板，可一起做。
4. crontab 完整清單（5 條 + P0 的備份）補進部署文件（`setup-production.sh` 註解或 `docs/DIGITALOCEAN_DEPLOYMENT_GUIDE.md`）。
5. `CronRunLog` 保留 90 天，`process-overdue` 執行時順路清理。`// ponytail: 順路清理，不另開清理任務`

**跳過**：失敗自動重試（crontab 次日會再跑，且 wrapper 已告警）、動態調整排程 UI、分散式鎖。

### 驗證

- 儀表板手動觸發 `overtime-warning` → `CronRunLog` 新增一筆、儀表板顯示剛剛的執行時間。
- 暫時弄壞任一任務（如指向錯誤資料表）→ `success=false` 且管理員收到 SYSTEM_ALERT 通知。
- 非管理員 POST cron 端點（無 CRON_SECRET）→ 401。

---

## 實施順序建議

1. **#1 餘額警示**先做——純呈現、風險最低、審核人立即有感。
2. **#2 排班覆蓋確認**——防資料誤損，dry-run 改動小。
3. **#3 離職補強**——含帳號停用，涉安全，需完整測試狀態流。
4. **#4 Cron 管理**——與 P0 #7 儀表板批次一起做最省。

## 路線圖同步修正

本次核實已回寫第一份路線圖：離職管理列（交接清單/強制檢查已存在，缺口改為模板/停用/結清檢查）。另注意路線圖 3.4-1 所寫「3 個 cron 任務」實為 **5 個端點**。

## 下一份文件

建議第五份：「P1 收尾清單」——通知事件接線細節（第三份 2.2-B 表的優先序 2、3 項）、設定測試按鈕、PasswordException UI、強制 2FA、敏感資料存取日誌，均為小顆粒項目，適合彙整成一份執行清單。
