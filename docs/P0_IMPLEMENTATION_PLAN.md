# P0 優化項目實施計畫（第二份）

> 產出日期：2026-07-02
> 前置文件：[SYSTEM_OPTIMIZATION_ROADMAP.md](./SYSTEM_OPTIMIZATION_ROADMAP.md)
> 範圍：路線圖中 7 項 P0，含現況佐證、具體變更、驗證方式、預估工作量。
> 環境事實：資料庫為 **SQLite**（`prisma/schema.prisma` datasource）；cron 路由以 `CRON_SECRET` header 驗證、由外部排程器（VPS crontab）觸發；部署為 PM2（`ecosystem.config.cjs`）。

## 總覽

| # | 項目 | 預估 | 相依 |
|---|------|------|------|
| 1 | 系統設定變更稽核日誌 | 2–3 天 | 無（基礎已齊，純接線） |
| 2 | SQLite 自動備份機制 | 1 天 | 無 |
| 3 | `limit=1000` 全量載入改分頁/搜尋 | 2–3 天 | 無 |
| 4 | 薪資計算預檢與日誌 | 2 天 | #1（共用稽核） |
| 5 | 安全事件告警通知 | 2 天 | 無 |
| 6 | 打卡頁 GPS 與防疫問卷提示 | 1–2 天 | 無 |
| 7 | 系統監控接上真實數據 | 2 天 | 無 |

建議順序：#1 → #2（低風險先上）→ #3 → #5 → #4 → #6 → #7。合計約 2–3 週。

---

## 1. 系統設定變更稽核日誌

> 狀態：第二階段已實作（2026-07-02）。所有 `src/app/api/system-settings/**/route.ts` 寫入 handler 已接 `SETTINGS_UPDATE/SystemSettings` 稽核；僅保留不寫入設定的明確例外：`smtp/test` 測試寄信、`labor-law-config` DELETE 歷史查詢。

### 現況

- `src/lib/audit.ts` 已有完整基礎：`logAudit()` 支援 `oldValue`/`newValue`/操作人/IP，且 `AuditAction.SETTINGS_UPDATE` 與 `AuditTargetType.SYSTEM_SETTINGS` 已定義。
- `src/app/api/system-settings/` 下所有會改變設定資料的 POST/PUT/PATCH/DELETE handler 已接 `SETTINGS_UPDATE/SystemSettings` 稽核。
- 已新增靜態 guard 測試，會掃描 `src/app/api/system-settings/**/route.ts`，避免後續新增寫入 handler 卻漏記稽核。
- 查詢端 `/api/audit-logs` 已存在，呈現層可沿用。

### 具體變更

1. 在每個 system-settings 路由的寫入 handler（POST/PUT/PATCH/DELETE）中，於資料庫更新前讀取舊值、更新後呼叫：
   ```ts
   await logAudit({
     userId: session.userId,
     action: AuditAction.SETTINGS_UPDATE,
     targetType: AuditTargetType.SYSTEM_SETTINGS,
     description: 'SMTP 設定變更',   // 各路由帶自己的名稱
     oldValue, newValue,
     ...getRequestInfo(request),
   });
   ```
2. 已新增共用 helper `src/lib/system-settings-audit.ts`，統一寫入 `SETTINGS_UPDATE/SystemSettings`，並遮罩 `password`、`token`、`secret`、`apiKey`、`idNumber` 等敏感欄位。
3. 已完成所有 system-settings 寫入路由接線，包含班別、獎金、審核流程、部門主管、健保眷屬、薪資條、密碼例外與通知相關設定。
4. 呈現層：在系統設定首頁加「設定變更紀錄」連結，指向既有 audit-logs 查詢頁並預帶 `targetType=SystemSettings` 與 `action=SETTINGS_UPDATE` 篩選。

### 驗證

- 改任一 SMTP 欄位 → `AuditLog` 表新增一筆，`oldValue`/`newValue` 正確、操作人與 IP 正確。
- SMTP 與薪資條 Email 密碼欄位在 AuditLog 中只顯示 `********`。
- 讀取類 GET 不產生紀錄。
- `npm test -- --runInBand src/lib/__tests__/system-settings-audit.test.ts` 需通過，確認 helper 行為與路由覆蓋率。

---

## 2. SQLite 自動備份機制

> 狀態：已實作（2026-07-02）。正式腳本為 `scripts/backup-database.sh`，相容入口為 `scripts/backup-db.sh`。

### 現況

- SQLite 單檔資料庫。
- 已補上 `.backup` 安全備份、gzip、完整性檢查、30 天本機保留與可選 rclone 異地同步。

### 具體變更（ponytail：檔案級備份即可，不需要備份管理系統）

1. 新增／升級 `scripts/backup-database.sh`，並提供相容入口 `scripts/backup-db.sh`：
   ```bash
   DB_PATH=/home/deploy/apps/changfu-attendance/prisma/prod.db \
   BACKUP_DIR=/home/deploy/backups \
   LOG_FILE=/home/deploy/backup.log \
   /home/deploy/apps/changfu-attendance/scripts/backup-database.sh
   ```
2. VPS crontab 每日 03:00 執行（與現有 cron 觸發方式一致，不進 app）：
   `0 19 * * * DB_PATH=/home/deploy/apps/changfu-attendance/prisma/prod.db BACKUP_DIR=/home/deploy/backups LOG_FILE=/home/deploy/backup.log /home/deploy/apps/changfu-attendance/scripts/backup-database.sh`
3. 備份目錄放在 `/home/deploy/backups`；腳本可選擇同步 `gdrive1`、`gdrive2`，若 rclone 未設定，仍保留本機備份並寫入 log；`setup-production.sh` 已補建目錄與可選 crontab 安裝步驟。
4. 還原程序寫成文件（本文件附錄 A），不做 UI —— 還原是罕見高危操作，走 SSH 比走網頁安全。

**跳過**：備份清單 UI、DatabaseBackup 模型、還原介面。需要時再加。

### 驗證

- 手動執行腳本 → 產生 .gz 備份；`gunzip` 後以 `sqlite3 <file> "PRAGMA integrity_check;"` 回傳 ok。
- 確認 30 天前的假檔案會被清除。
- 線上 crontab 已安裝每日台灣時間 03:00 備份，並已手動驗證一次。

---

## 3. `limit=1000` 全量載入改分頁/搜尋

### 現況（5 處）

| 檔案 | 用途 |
|------|------|
| `src/app/schedule-management/page.tsx:1281` | 排班選員工 |
| `src/app/annual-leaves/page.tsx:120` | 特休配置選員工 |
| `src/app/password-management/page.tsx:290` | 密碼管理選員工 |
| `src/app/system-settings/attendance-permissions/page.tsx:122` | 考勤權限選員工 |
| `src/app/payroll/page.tsx:176` | 薪資查詢（管理員）選員工 |

### 具體變更

1. 確認 `/api/employees` 已支援 `search` + `limit` 參數（員工管理頁已在用分頁，API 大概率已支援；若缺 `search` 對 name/employeeId 的 LIKE 查詢則補上）。
2. 新增共用元件 `src/components/EmployeeSelect.tsx`：輸入即搜尋（debounce 300ms）、呼叫 `/api/employees?search=<kw>&limit=20&status=active`、鍵盤可操作。
3. 5 處逐一替換原本「載入 1000 筆進下拉」的寫法。annual-leaves 的「批量選人」情境需要多選 → 元件支援 `multiple`，或該頁改為「依部門載入」（部門人數有限，不需全公司）。

### 驗證

- 各頁面開啟時 Network 面板不再出現 `limit=1000` 請求。
- 搜尋「王」可找到目標員工並完成原有操作（排班、配置特休等）。

---

## 4. 薪資計算預檢與日誌

### 現況

- 薪資產生走 `src/app/api/payroll/generate`，另有 `payroll/preview`。計算過程無預檢、無錯誤彙總；`AuditAction.PAYROLL_GENERATE` 已定義但需確認是否有呼叫。

### 具體變更

1. 在 `payroll/preview`（或 generate 的 dry-run 模式）回應中加入 `warnings` 陣列，逐員工檢查：
   - 無銀行帳號（影響轉帳報表）
   - 當月在職但無底薪紀錄
   - 離職員工仍被納入計算
   - 考勤未凍結月份（若業務規則要求先凍結）
2. 前端 `src/app/salary-management/page.tsx`：按「計算薪資」先呼叫 preview，有 warnings 時彈出清單，需確認才真正 generate。
3. generate 完成後呼叫 `logAudit({ action: AuditAction.PAYROLL_GENERATE, ... })`，description 記錄月份、筆數、略過筆數。
4. generate 失敗時回傳具體錯誤（哪位員工、什麼原因），前端顯示，不再吞錯。

### 驗證

- 建一位無銀行帳號的測試員工 → 計算前彈出警告；確認後仍可產生。
- AuditLog 出現 PAYROLL_GENERATE 紀錄。

---

## 5. 安全事件告警通知

### 現況

- `src/lib/security-monitoring.ts`（415 行）已有 `logSecurityEvent()`、`RiskLevel`、`blockIP()`、`getSecurityStats()`，但事件只進記憶體，**無任何通知**；重啟即歸零。

### 具體變更（ponytail：先接通知，不重寫儲存層）

1. 在 `logSecurityEvent()` 中，當 `riskLevel` 為 HIGH/CRITICAL 時，呼叫既有 in-app 通知服務發給管理員角色，事件類型用已定義的 `SECURITY_ALERT`；CRITICAL 加發 email（沿用 `src/lib/email.ts`）。
2. 加 5 分鐘同型事件節流（同 IP + 同事件型別只發一次），避免暴力嘗試灌爆信箱——記憶體 Map 即可。
3. `blockIP()` 觸發時同樣通知。
4. 已知限制加註：`// ponytail: 事件存記憶體，重啟歸零；需要留存時改寫入 AuditLog`。

**跳過**：安全儀表板、風險趨勢圖 —— 屬 P1（roadmap 3.3-3 的展示部分）。

### 驗證

- 連續錯誤密碼登入觸發 HIGH 事件 → 管理員收到站內通知一則（5 分鐘內重複觸發不重發）。

---

## 6. 打卡頁 GPS 與防疫問卷提示

### 現況

- `src/app/attendance/page.tsx`（1661 行）：GPS 邏輯在約 L409–520，錯誤訊息已部分人性化（如「GPS定位超時。請移到訊號較好的位置」L426），但權限被拒/低精度情境訊息仍偏技術性；定位進度條可能長時間停在高百分比。
- 防疫問卷（InfectionControlForm）必填未完成時打卡按鈕僅禁用、無原因提示。

### 具體變更

1. GPS 錯誤訊息統一走一個對照函式：權限拒絕 → 附各瀏覽器開啟位置權限的步驟；精度不足 → 「請移至戶外空曠處」+ 顯示目前精度 vs 要求精度；超時 → 提供「重試」與「改用 WiFi 驗證」（若該地點允許）按鈕。
2. 進度條 90% 後改為不定量動畫（pulse），避免「卡死」觀感。
3. 打卡按鈕禁用時，按鈕下方顯示禁用原因（「請先完成防疫問卷：尚有 2 題未填」），並點擊可捲動至第一個未填欄位。

### 驗證

- 瀏覽器封鎖定位權限 → 顯示開啟步驟而非技術錯誤。
- 問卷留空 → 按鈕下方出現原因提示，點擊捲至未填欄位；填完提示消失、按鈕啟用。

---

## 7. 系統監控接上真實數據

### 現況（修正早前誤判）

- 前端 `src/components/SystemMonitoringDashboard.tsx`（608 行）已存在，呼叫 `/api/system-maintenance`。
- 缺口在後端：`src/lib/system-maintenance.ts` 的任務清單只存在**記憶體**，非真實系統狀態；`/api/health` 只檢查 DB 連線。

### 具體變更

1. 擴充 `/api/health`：DB 連線 + SQLite 檔案大小 + 磁碟剩餘空間（`statfs`）+ 記憶體使用（`process.memoryUsage()`）+ SMTP 設定存在性（不實連，避免每次 health check 打 SMTP）。
2. `SystemMonitoringDashboard` 的 overview 區塊改讀擴充後的 health 數據；保留原有維護任務區塊。
3. 顯示最近一次備份時間（讀備份目錄最新檔案 mtime，與 #2 銜接）與 app 版本（`process.env.APP_VERSION`，deploy script 以 git tag 注入，順手解掉「v2.1.0 硬寫」技術債）。

**跳過**：維護任務持久化與自動執行（roadmap 3.4-2，P2）。

### 驗證

- 開啟 `/system-monitoring` → 顯示真實磁碟/記憶體/DB 大小/最近備份時間。
- `curl /api/health` 回傳各組件狀態 JSON。

---

## 附錄 A：SQLite 還原程序（SOP）

1. 停止服務：`pm2 stop <app>`
2. 現況存檔：`cp prisma/prod.db prisma/prod.db.broken-$(date +%Y%m%d)`
3. 解壓還原：`gunzip -c backups/attendance-<日期>.db.gz > prisma/prod.db`
4. 完整性檢查：`sqlite3 prisma/prod.db "PRAGMA integrity_check;"` 須回 `ok`
5. 重啟：`pm2 start <app>`，登入抽查考勤/薪資資料

## 下一份文件

P0 完成後，建議第三份為「P1 共用元件設計」：批次工作流元件 + 通知中心，兩者是 P1 影響面最大的項目。
