# 財產管理模組 Bug 稽核（第十份）

> 產出日期：2026-07-09
> 稽核範圍：`src/app/api/property-maintenance/`（26 個路由）、`src/lib/property-*.ts`（19 個檔案）、`src/app/property-management/`（10 個頁面）、schema 模型（PropertySite ～ AssetModificationRequest）
> 方法：逐檔精讀任務產生、修改申請、稽核流程、條碼查找、cron 提醒等核心路徑。資料現況約 190 資產／1890 維護紀錄。

## 先說結論：模組體質

財產管理是全系統**體質最好**的模組，以下機制查核過**正確**，修復時不要動壞它們：

- 日期工具台北時區錨定正確（`property-maintenance-utils.ts` 的 `startOfDay`/`ymd`——**除了 monthRange，見 PA1**）
- 任務產生有交易 + 樂觀鎖（`nextMaintenanceDate` 條件更新）+ unique 防重（P2002 捕捉）
- 稽核有據點主管權限（`canSuperviseSite`）、防自審、並發狀態防護
- 修改申請有欄位白名單（`PROPERTY_EDITABLE_FIELDS`）
- Cron 有逐據點 try/catch 隔離與 `dedupeKey` 去重

## 問題總表

| # | 問題 | 嚴重度 | 觸發條件 |
|---|------|--------|----------|
| PA1 | `monthRange` 用 UTC 月界——每月 1 號的紀錄滑進上個月的報表/統計 | **高** | **每月都發生**，影響現有 1890 筆紀錄的月報 |
| PA2 | 核准「應維護頻率」修改無解析驗證——打錯字該資產**從此不再自動產生維護任務** | **高** | 核准無法解析的頻率文字時 |
| PA3 | 「相差超過一個週期就今天到期」規則的雙向副作用 | 中 | 資產逾期超過一週期、或改期到一週期外 |
| PA4 | 維護週期錨定「產生日」而非「應維護日」——排程漂移 | 中（需確認意圖） | 任務逾期產生時 |
| PA5 | 條碼只編財產編號，跨據點不保證唯一——掃碼可能命中錯的據點 | 中 | 多據點且財產編號重複時 |
| PA6 | 修改申請核准無時效性檢查——舊申請蓋掉新值 | 中 | 申請期間資產被直接修改時 |
| PA7 | 重複稽核覆寫 AuditApproval——退回輪次的紀錄消失 | 中 | 退回補正 → 重送 → 再稽核 |
| PA8 | 自審防護在維護人未解析為員工時失效 | 低 | maintainerEmployeeId 為空時 |
| PA9 | 刪除紀錄不刪實體檔案——照片/簽章/附件孤兒累積 | 低 | 恆常 |
| PA10 | 去重紀錄寫入失敗被吞——已寄郵件下次重寄 | 低 | 罕見 |
| PA11 | Cron 錯誤僅 console.error | 低 | 併入第四份 CronRunLog 計畫 |
| PA12 | 兩套稽核狀態詞彙並存（中文字串 vs 英文枚舉） | 低 | 技術債 |
| PA13 | 匯入日期解析需確認支援字串日期 | 低（檢查點） | 匯入含文字日期欄時 |

---

## 高嚴重度

### PA1 `monthRange` 用 UTC 月界，每月 1 號的紀錄滑進上月報表

**位置**：`src/lib/property-maintenance-utils.ts:98-101`；消費端 `api/property-maintenance/stats/route.ts:56`、`src/lib/property-report-service.ts:68,372`（月報、統計）

**現象**：全模組的日期都以**台北午夜**儲存（`taipeiMidnight`，= UTC 前一日 16:00），唯獨 `monthRange` 回傳 **UTC 月界**（`Date.UTC(year, month-1, 1)`）。台北 7/1 的紀錄實際儲存為 `6/30T16:00Z`，小於 UTC 7 月起點 `7/1T00:00Z` → **被算進 6 月**。

**後果**：每月 1 號（台北）到期/完成的維護紀錄，在月報與統計中被歸入**前一個月**——月報筆數對不上、跨月稽核佐證表漏項。1890 筆紀錄中所有落在每月 1 號的都受影響。

**修正方向**：`monthRange` 改用 `taipeiMidnight(year, month, 1)` 作起迄（同檔案內工具就有）；修正後抽查 1 號紀錄的月報歸屬。

### PA2 核准「應維護頻率」修改無解析驗證——資產靜默退出維護排程

**位置**：`api/property-maintenance/modification-requests/[id]/route.ts:42-44`；後果端 `src/lib/property-due-task-service.ts:52`

**現象**：核准 `maintenanceFrequency` 修改時直接 `frequencyDays = normalizeFrequencyDays(proposedValue)`——**解析失敗回 null 也照樣寫入**。對照同一段程式：`nextMaintenanceDate` 有格式驗證（L46-48 無效即擋）、`photoPath` 有路徑驗證，唯獨頻率沒有。

**後果**：任務產生只挑 `frequencyDays: { not: null }` 的資產——頻率打錯字（如「每季一次左右」解析不出）並核准後，該資產**從此不再自動產生維護任務**，無任何警告，直到有人發現它很久沒被維護。

**修正方向**：核准時 `normalizeFrequencyDays` 回 null 即拒絕（與日期欄同款防護）；申請建立時就先驗證更好。存量檢查：`SELECT * FROM property_assets WHERE maintenance_frequency IS NOT NULL AND frequency_days IS NULL`。

---

## 中嚴重度

### PA3 「相差超過一個週期就今天到期」規則的雙向副作用

**位置**：`src/lib/property-due-task-service.ts:34-36`

```ts
if (Math.abs(diffDays) > asset.frequencyDays) return today;
if (nextMaintenanceDate <= today) return nextMaintenanceDate;
```

`nextMaintenanceDate` 與今天相差超過一個頻率週期時，一律回「今天」作為到期日。兩個方向的副作用：

1. **逾期超過一週期**（如頻率 30 天、已逾期 60 天）→ dueDate 設為今天而非實際逾期日——**逾期事實被掩蓋**（報表上看起來準時）；逾期不足一週期反而保留過去日期（L36）。同一種逾期兩種表現。
2. **未來超過一週期**（如手動把維護日改到 90 天後、頻率 30 天）→ 立即產生一筆今天到期的任務，並把下次維護日改為今天+30——**手動改期被系統默默撤銷**。

**修正方向**：確認此規則意圖（可能是「資料不一致時重新錨定」的防呆）。建議：逾期側保留實際逾期日（一致的逾期語意）；未來側尊重手動設定不產生任務；若防呆有必要，至少記 log 讓異常可見。

### PA4 維護週期錨定「產生日」而非「應維護日」（需確認意圖）

**位置**：`due-task-service.ts:88`（`nextMaintenanceDate: addDays(today, frequencyDays)`）

任務產生時，下次維護日 = **今天** + 頻率，而非 dueDate + 頻率。當任務是為過去的逾期日產生時（L36 路徑），排程整體向後漂移逾期的天數。頻率 30 天、每次晚 5 天產生 → 一年後排程漂移約 2 個月。若業務語意是「從實際維護算起」則此設計沒錯（但那應錨定**完成日**而非產生日）；若是「固定週期」則應錨定 dueDate。

**修正方向**：與業務確認語意後統一錨點；現況「產生日」是兩種語意都不精確的中間值。

### PA5 條碼只編財產編號，跨據點掃碼可能命中錯資產

**位置**：`api/property-maintenance/assets/[id]/barcode/route.ts:30`（只編 `assetCode`）；`assets/lookup/route.ts:18-19`（`findFirst` + 使用者可及據點）

財產編號唯一性是**據點內唯一**（`@@unique([siteId, assetCode])`）——兩個據點可以有相同編號。條碼只含編號，多據點權限的使用者（SUPERVISOR/ADMIN）掃碼時 `findFirst` **取任意一筆命中**——可能對錯的據點資產做維護登記。目前 190 筆資產或許尚無跨站重碼，屬**資料相依的地雷**。

**修正方向**：lookup 命中多筆時回傳清單要求選擇據點（低成本）；或新資產條碼帶據點代碼前綴（如 `XIBEI-A001`，PropertySite.code 現成可用）。

### PA6 修改申請核准無時效性檢查

**位置**：`modification-requests/[id]/route.ts`（核准段全無 originalValue 比對）

核准時不檢查資產**目前值**是否仍等於申請時的 `originalValue`。時序：申請把地點從 A 改 B → 期間管理員直接把地點改成 C → 核准舊申請 → C 被蓋成 B，且稽核紀錄顯示「A→B」與事實不符。

**修正方向**：核准時比對現值與 originalValue，不符即擋下要求重新申請（樂觀鎖模式，任務產生服務已示範同款寫法）。

### PA7 重複稽核覆寫 AuditApproval，退回輪次紀錄消失

**位置**：`records/[recordId]/audit/route.ts:85-90`（`findFirst` → `update` 同一列）

流程支援「退回補正 → 重送 → 再稽核」，但 `AuditApproval` 每輪稽核都**更新同一筆**——第一輪的退回決定（誰退的、何時、為什麼）被第二輪覆寫。`MaintenanceRecord` 上的稽核欄位同樣只留最新。若 AuditApproval 的定位是稽核軌跡，多輪歷史已失真。

**修正方向**：改為每輪 `create` 新列（表已有 recordId 索引，查最新用 `orderBy createdAt desc` 即可）；或至少在 note 累加歷史。

---

## 低嚴重度

### PA8 自審防護在維護人未解析為員工時失效

**位置**：`audit/route.ts:27-29`

防自審檢查 `rec.maintainerEmployeeId === 審核人`——但 `maintainerEmployeeId` 是「盡力解析」欄位（維護人可能只有 raw 姓名）。未解析時（null），做維護的主管可以稽核自己的紀錄。可加姓名比對作第二道防線（`maintainerRaw` vs 審核人姓名），仍非完美但堵住多數情況。

### PA9 刪除紀錄不刪實體檔案

附件、照片、簽章的實體檔案在紀錄刪除（DB Cascade）後殘留磁碟，孤兒檔案隨時間累積。修正：刪除路由順路 unlink，或併入第四份 cron 計畫做定期孤兒清掃（比對 DB 路徑與磁碟檔案）。

### PA10 去重紀錄寫入失敗被吞

**位置**：`property-cron-service.ts:81-89`（`markSent` 的 catch 空吞）

郵件寄出後寫 `PropertyMaintenanceReminderLog` 失敗時靜默——下次 cron 因查無 dedupeKey 而**重寄**。影響輕（重複提醒信），但 catch 至少該 log。

### PA11 Cron 錯誤僅 console.error

逐據點失敗有隔離（好），但只進 console——與第四份文件的 `CronRunLog` + 失敗告警計畫銜接，property 三個 cron 一併包進 `withCronRunLog` 即可，此處不重複規劃。

### PA12 兩套稽核狀態詞彙並存

`MaintenanceRecord.auditStatus` 用中文字串狀態機（`'待主管稽核'`/`'已通過'`/`'退回補正'`），`AuditApproval.auditStatus` 用英文枚舉（`PENDING`/`APPROVED`/`REJECTED`）。同一件事兩套詞彙，消費端要同時認得兩種。技術債：統一為英文枚舉 + 顯示層對照表（`property-status-ui.ts` 已存在，適合承接）。

### PA13 匯入日期解析檢查點

**位置**：`src/lib/property-import-service.ts:329-330`（`excelSerialToDate`）

`acquiredDate`/`nextMaintenanceDate` 以 Excel 序號解析——需確認來源 xlsx 若含**文字格式日期**（"2026/7/1"）時的行為（序號解析會失敗或算出錯誤日期）。實作時做一次含文字日期的匯入測試即可。

---

## 建議修復順序

1. **PA1（monthRange）**——一行修正 + 報表抽查，月報正確性立即恢復。半天。
2. **PA2（頻率驗證）+ 存量盤點**——防資產靜默脫離維護，半天。
3. **PA3/PA4 與業務確認規則意圖**後修正錨點與逾期語意——1 天。
4. **PA5–PA7**（lookup 多筆選擇、staleness 檢查、稽核歷史保留）——各半天。
5. **PA8–PA13** 見縫插針；PA11 併入第四份 Cron 計畫。

**與前兩份稽核的對照**：考勤模組的兩大根因（核准↔撤銷不對稱、撤銷路徑缺防護）在本模組**大致不存在**——修改申請有白名單、稽核有並發防護與防自審。本模組的根因模式是**「防呆規則的副作用未被審視」**（PA1 的 UTC 月界、PA3 的重新錨定規則、PA2 的靜默 null）——修復時針對每條隱式規則問一句「這條規則在反方向會做什麼」。
