# 申請模組修正項目稽核：調班／請假／加班／忘打卡／撤銷×薪資／審核流程設定（第九份）

> 產出日期：2026-07-08
> 前置文件：[ATTENDANCE_CALC_BUG_AUDIT.md](./ATTENDANCE_CALC_BUG_AUDIT.md)（第八份，考勤計算稽核；本文件與其重疊處以「B 編號」引用）
> 方法：逐檔精讀各模組的建立／核准／撤銷／作廢路由與其資料寫入，每項附程式碼位置。**僅列出問題與修正方向，不含修復實作。**

## 總表

| # | 模組 | 問題 | 嚴重度 |
|---|------|------|--------|
| M1 | 忘打卡 | 核准把 "HH:MM" 字串寫入 DateTime 欄位——核准必然失敗或寫入無效值 | **高** |
| M2 | 忘打卡 | workDate 型別不匹配，永遠找不到既有考勤記錄 → 產生同日重複記錄 | **高** |
| M3 | 忘打卡 | 核准後不重算工時——補卡日存儲工時仍為 0，薪資領不到 | **高** |
| M4 | 忘打卡 | 撤銷/作廢不回復考勤記錄——補上的時間留著繼續算薪水 | **高** |
| P1 | 撤銷×薪資 | 所有撤銷/作廢路由**無考勤凍結檢查**——凍結被繞過 | **高** |
| P2 | 撤銷×薪資 | 撤銷不檢查該月薪資是否已產生，也不通知/標記重算 | **高** |
| O1 | 加班 | 補休回沖失敗被吞——撤銷照樣完成，補休沒扣回 | **高** |
| S1 | 調班 | 業務資料以 JSON 塞在「申請原因」欄位，核准/撤銷都靠解析它 | 中 |
| S2 | 調班 | 撤銷還原用硬編碼 A/B/C 班別模板，與核准端（查 ShiftDefinition）不對稱 | 中 |
| S3 | 調班 | 班別解析不到時靜默 fallback 成 A 班 | 中 |
| O2 | 加班 | 補休回沖可產生負餘額；凍結月份的補休帳仍被改動 | 中 |
| O3 | 加班 | 撤銷不清考勤記錄上的加班關聯與已存加班時數 | 低 |
| L1–L3 | 請假 | 班表清空不還原（B3）、半天假整段清空（B7）、特休薪資斷鏈（B15） | 高（見第八份） |
| L4 | 請假 | 可撤銷任意歷史月份的已休假，無日期限制 | 中 |
| L5 | 請假 | **補休假核准根本不扣補休餘額**（單筆與批次皆確認）——補休免費請 | **高** |
| W1 | 審核流程設定 | 設定只對請假/加班主流程生效——忘打卡、調班、**所有撤銷流程**硬編碼不吃設定 | **高** |
| W2 | 審核流程設定 | 快取過期邏輯錯誤（全域單一 expiry 且每次寫入延長）——設定變更可能長期不生效 | 中 |
| W3 | 審核流程設定 | 三階（HR 會簽）只有標籤、無狀態機實作（已確認） | 中 |
| W4 | 審核流程設定 | DB 讀取失敗靜默 fallback 預設流程，無告警 | 低 |

---

## 一、忘打卡管理（問題最密集，整條核准鏈都需要修）

### M1 核准把 "HH:MM" 寫入 DateTime 欄位（高）

**位置**：`api/missed-clock-requests/route.ts:458-491`、`batch-approve/route.ts:184-216`

`MissedClockRequest.requestedTime` 是 `String`（格式 "HH:MM"，schema 註解與測試皆確認，如 `'09:00'`），核准時**直接**指派給 `AttendanceRecord.clockInTime/clockOutTime`——這兩個是 Prisma `DateTime` 欄位。Prisma 對 DateTime 只接受 Date 物件或完整 ISO-8601 字串，"09:00" 會拋 ValidationError → **核准交易在寫入考勤那步失敗回滾（500）**。單筆與批次核准同款寫法。

**修正方向**：以 `workDate` + `requestedTime` 組合完整時間戳（台灣時區，沿用 `timezone.ts` 工具），再寫入。

### M2 workDate 型別不匹配 → 同日重複考勤記錄（高）

**位置**：`route.ts:450-455`（查找）、`:488-490`（建立）；批次同款

`MissedClockRequest.workDate` 是字串 "YYYY-MM-DD"；查找既有考勤用 `new Date("2026-07-08")` = **UTC 午夜**（台灣 08:00）。但打卡路由建立的 `AttendanceRecord.workDate` = **台灣午夜**（UTC 前一日 16:00）。兩個時刻永不相等 → 等值查找**永遠找不到**既有記錄 → 永遠走 else 分支另建一筆 workDate=UTC 午夜的新記錄。因唯一鍵是 (employeeId, workDate 時刻)，兩筆並存不衝突——同一個台灣日出現**兩筆考勤記錄**，且都落在該日的查詢範圍內（UTC 午夜 = 台灣 08:00，在當日區間內），列表重複、加總雙算。

**修正方向**：查找與建立統一用 `getTaiwanDayStart()` 轉換 workDate 字串。

### M3 核准後不重算工時（高）

**位置**：`route.ts`、`batch-approve/route.ts` 全檔（無任何 `calculateAttendanceHours` / `regularHours` 寫入）

補下班卡核准後只寫 clockOutTime，**不重算** `regularHours`/`overtimeHours`——該日存儲工時維持 0。第八份 B8 的「顯示層重算優先」會讓 records 頁面**看起來正確**，但薪資端讀的是存儲值 → **員工看得到工時、領不到錢**，且無人會發現（顯示是對的）。

**修正方向**：核准寫入打卡時間後，若該記錄上下班卡齊全，呼叫 `calculateAttendanceHours`（帶當日班表）回寫工時——與打卡路由 `clock/route.ts:331-341` 同款邏輯。

### M4 撤銷/作廢不回復考勤（高）

**位置**：`api/missed-clock-requests/[id]/cancel/route.ts`、`void/route.ts`（兩檔**零** AttendanceRecord 引用，已確認）

已核准的補打卡被撤銷或作廢時，只改申請單狀態——**補上去的打卡時間留在考勤記錄裡**，繼續參與工時與薪資計算。作廢一筆造假的補卡申請，實際上什麼都沒收回。

**修正方向**：撤銷/作廢核准時，將該筆補卡寫入的 clockIn/OutTime 清除（需記錄「該時間是補卡寫入的」——可在 AttendanceRecord 加來源欄位或用 MissedClockRequest 反查），並重算工時。

---

## 二、調班管理

### S1 業務資料塞在 requestReason（中）

**位置**：`api/shift-exchanges/[id]/route.ts:62-69,91-126`（核准）、`api/shift-exchange-requests/[id]/cancel/route.ts:49`（撤銷）

調班的核心資料（原班別、新班別）以 JSON 字串存在**「申請原因」**欄位，核准與撤銷都靠 `JSON.parse(requestReason)` 還原。原因欄位被當資料庫用：任何人工編輯原因、或格式不符（舊互調資料），核准/撤銷直接 throw「員工互調功能已停用」。

**修正方向**：`ShiftExchangeRequest` 加正式欄位（originalShiftType、newShiftType），reason 回歸純文字；存量資料一次性遷移。

### S2 撤銷端硬編碼班別模板，與核准端不對稱（中）

**位置**：`api/shift-exchange-requests/[id]/cancel/route.ts:30-37`（`void/route.ts` 同款）

核准端正確地查 `ShiftDefinition`（`findActiveScheduleFieldsForShift`，班別停用還會擋）；撤銷端卻用**寫死的對照表**：`A: 07:30-16:30, B: 08:00-17:00, C: 08:30-17:30`，未知班別回 `{ startTime: '', endTime: '' }`。班別定義一改（或新增 D 班），撤銷還原出錯誤時間；未知班別直接把班表時間清空（同 B3 的破壞模式）。

**修正方向**：撤銷端改用與核准端同一個 `findActiveScheduleFieldsForShift`。

### S3 解析不到班別時靜默 fallback 成 A 班（中）

**位置**：核准 `shift-exchanges/[id]/route.ts:95`（`parsed?.new || 'A'`）、撤銷 `cancel/route.ts:52`（`parsed?.original ?? 'A'`）

payload 缺班別欄位時不報錯，**假設是 A 班**——錯誤的班表被無聲寫入。應改為缺資料即拒絕操作。

### S4 撤銷無凍結檢查、無已打卡檢查（中，併入 P1）

主流程 `shift-exchanges` 有 import 考勤凍結檢查；撤銷端沒有。且撤銷把班表改回原班時，不檢查**該日是否已按新班打卡**——已發生的考勤與還原後的班表不符（觸發 B8 重算漂移）。

---

## 三、請假管理

### L1–L3（已詳載於第八份，此處僅索引）

- **B3**：核准清空班表起訖時間、撤銷/作廢不還原——每次「核准後撤銷」永久破壞班表。
- **B7**：半天假也整段清空班表——另外半天班脫離所有監控。
- **B15**：特休核准不寫 `specialLeaveHours`，與薪資有薪假時數來源斷鏈（需業務確認）。

### L4 可撤銷任意歷史月份的已休假（中）

**位置**：`api/leave-requests/[id]/cancel/route.ts:133-141`（僅檢查狀態為 APPROVED）

撤銷申請只檢查「已核准」與「無進行中撤銷」——**已經休完、甚至數月前的假都能發起撤銷**，核准後特休餘額回補、但當月薪資早已結算（見 P2）。應加日期限制（如僅限假期開始前或當月內）或至少對過去日期強警示。

### L5 補休假核准不扣補休餘額（高，2026-07-08 查證升級）

**位置**：`src/lib/leave-types.ts:38-58`（COMPENSATORY 為正式請假選項，含專屬原因清單「加班補休」等）；`api/leave-requests/` 全目錄（單筆 `[id]`、`batch`、`batch-approve`）**零** compLeave/COMPENSATORY 處理（已 grep 確認）

補休（COMPENSATORY）是請假表單上可選的假別，但**整條請假核准鏈都不會扣減 CompLeaveBalance**——不掛 pendingUse、不建 USE 交易。對照：特休核准會自動扣 `annualLeave.usedDays`；補休假核准後補休帳**原封不動**。員工請補休假等於免費休假，除非管理員另外在補休管理模組手動登記（斷鏈模式與 B15 特休薪資斷鏈同款）。

撤銷面連帶確認：`approveCancellation`（`cancel/route.ts:27-63`）只回補特休——但因核准根本沒扣，撤銷「不回補」反而歪打正著；一旦修了核准端扣減，撤銷端必須同步補回補邏輯，否則變成扣了不還。

**修正方向**：核准 COMPENSATORY 假別時比照加班補休的帳務模式（掛 `pendingUse` + USE 交易，凍結時結轉）；撤銷/作廢時對稱回沖；上線前盤點存量已核准補休假與 CompLeaveBalance 的差額。

### L6 撤銷審核的 Admin 分支重複貼上（低）

`cancel/route.ts:262-321`：PENDING_ADMIN 與 PENDING_MANAGER 兩段幾乎相同的程式碼複製——合併為一段（`['PENDING_ADMIN','PENDING_MANAGER'].includes(...)`，加班撤銷那邊就是這樣寫的）。

---

## 四、加班管理

### O1 補休回沖失敗被吞（高）

**位置**：`api/overtime-requests/[id]/cancel/route.ts:37-55`（return false 分支）、`:293-318`（照樣完成撤銷）

撤銷核准時回沖補休（`reverseCompLeave`），但「找不到補休餘額記錄」或「找不到原始獲得交易」時只 `console.log` 後 **return false，撤銷照常完成**（`compLeaveReversed: false` 存檔）。結果：加班取消了、換來的補休還在，員工可以繼續用。無告警、無人工處理清單。

**修正方向**：回沖失敗應中止撤銷（交易回滾）或至少發管理員通知 + 進待處理清單；`compLeaveReversed=false` 的存量資料需盤點。

### O2 回沖可產生負餘額；凍結期補休帳被改動（中）

**位置**：`cancel/route.ts:60-71`

原始獲得交易已凍結時，直接 `balance: { decrement }`——若補休已被用掉，餘額**無聲變負**；未凍結時走 `pendingUse: { increment }`，語意是「掛一筆待用扣減」，若員工其實已用掉同樣有帳務衝突。且「已凍結」代表該月補休帳已隨薪資結算——事後改動使總帳與已結算薪資不符（與 P2 同根源）。

**修正方向**：回沖前檢查可用餘額；不足時擋下並要求人工決策（扣薪或下期扣）；凍結期間的回沖一律轉人工。

### O3 撤銷不清考勤上的加班殘留（低）

撤銷不清 `AttendanceRecord.clockInOvertimeId/clockOutOvertimeId` 與已存 `overtimeHours`。薪資端靠 `status: 'APPROVED'` 過濾（`payroll-processing.ts:750-753`）所以**錢不會多發**，但 records 顯示的加班時數殘留（B9 同類的顯示與實發不一致）。

### O4 Admin 可跳過主管直接決核（設計確認）

`cancel/route.ts:286-288`：撤銷在 PENDING_MANAGER 狀態時 ADMIN 也能直接核准（請假撤銷同款 L293）。若為刻意的管理員特權，建議在審核紀錄註明「跳過主管」；若非刻意則收斂。

---

## 五、請假/加班撤銷 × 薪資計算

### P1 所有撤銷/作廢路由無考勤凍結檢查（高）

**已確認**：申請的**建立/核准**主路由都有凍結檢查（`lib/attendance-freeze` 被 leave/overtime/missed-clock/shift-exchanges 主 route 引用），但六條撤銷/作廢路由（請假 cancel/void、加班 cancel/void、補打卡 cancel/void、調班 cancel/void）**全部沒有**。凍結的意義是「該月考勤已鎖定供薪資結算」——撤銷路徑完全繞過：凍結後仍可撤假（特休回補、班表變動）、撤加班（補休回沖）、作廢補卡。

**修正方向**：六條路由統一加凍結檢查（抽一個共用 guard）；凍結期間的撤銷需求走「管理員例外流程 + 稽核記錄」。

### P2 撤銷不檢查該月薪資是否已產生（高）

任何撤銷核准（特休回補、加班費取消、補休回沖、補卡作廢）都**不查該月 `PayrollRecord` 是否已存在/已發放**，不通知薪資管理員、不標記該月需重算。時序：7 月薪資 8/1 產生發放 → 8/5 員工撤銷 7 月的加班 → 加班費已發、系統無任何沖銷或提示——帳實不符且無人知道。

**修正方向**（成本由低到高擇一即可起步）：
1. 撤銷核准時查該月 PayrollRecord：存在 → 回應與通知帶「該月薪資已產生，請人工處理差額」警示（半天工作量）。
2. 進一步：自動建立 `PayrollAdjustment`（**模型已存在**，schema L1743）掛到次月沖銷——不必重算已發薪資。
3. 全自動重算不建議（已發放的薪資不該被靜默改寫）。

### P3 補休回沖的凍結衝突

即 O2 的帳務面：已凍結月份的 CompLeaveBalance/Transaction 被撤銷改動後，與該月已結算的薪資對不上。修 P1（凍結 guard）即同時解決。

---

## 六、審核流程管理之審核流程設定

### W1 設定覆蓋不全——半數流程硬編碼不吃設定（高）

**已確認**（grep `getApprovalWorkflow`/`isTwoLevelApproval` 的消費者）：

| 流程 | 是否吃審核流程設定 |
|------|--------------------|
| 請假主流程 | ✓（含部門別，`leave-requests/[id]/route.ts:223,254`） |
| 加班主流程 | ✓（含部門別，`overtime-requests/[id]/route.ts:124,156`） |
| **忘打卡主流程** | ✗ 硬編碼二階（PENDING → PENDING_ADMIN + manager 欄位） |
| **調班主流程** | ✗ 硬編碼 |
| **全部六條撤銷流程** | ✗ 硬編碼二階（PENDING_MANAGER → PENDING_ADMIN） |

後果：在設定頁調整忘打卡/調班的審核層級**完全無效**；而前端透過 `approval-workflow-config` GET 顯示的層級標籤（一階/二階/三階）是從設定算的——**畫面顯示的流程與後端實際執行的流程可以不一致**（顯示一階、實際硬編碼二階）。

**修正方向**：忘打卡與調班主流程接上 `getApprovalWorkflow`（比照請假的寫法）；撤銷流程若刻意固定二階，設定頁與前端顯示應明確標示「撤銷流程固定二階，不受此設定影響」。

### W2 快取過期邏輯錯誤（中）

**位置**：`src/lib/approval-workflow.ts:44-46,59-61,111-112`

快取用**單一全域** `cacheExpiry`，且**每次寫入任何 key 都把全體過期時間延長 60 秒**（L112）。持續流量下不斷有新 key 寫入 → 過期時間一直被推遲 → 舊設定**可能長期不失效**。`clearWorkflowCache()` 只在設定更新的那個進程生效——PM2 多實例部署時其他實例讀舊值。

**修正方向**：per-entry 過期時間戳（每筆 `{ config, expiresAt }`）；一分鐘 TTL 下多實例的不同步窗口可接受，無需跨進程失效機制。

### W3 三階（HR 會簽）只有標籤、無狀態機實作（中，2026-07-08 已確認）

**位置**：`api/approval-workflow-config/route.ts:17-19`（三階標籤）、`leave-requests/[id]/route.ts` 狀態機（已確認全檔僅 `PENDING` → `PENDING_ADMIN` 兩態，無任何 HR 會簽中間狀態）

設定允許 `approvalLevel = 3`（標籤：主管 → HR 會簽 → 管理員決核），但執行端狀態機只有二階結構（manager 意見欄位 + admin 決核）。設定成三階時實際仍走二階——**設定頁提供了一個做不到的選項**，且前端層級標籤會顯示三階、後端執行二階（與 W1 同款的顯示與執行不一致）。

**修正方向**：短期把三階選項從設定 UI 拿掉（避免誤導）；若確有 HR 會簽需求再實作狀態機。

### W4 DB 失敗靜默 fallback 預設流程（低）

**位置**：`approval-workflow.ts:115-130`

讀取設定失敗時回傳寫死的預設（二階、ADMIN 終審、48h 期限），只 console.error——資料庫抖動期間，部門自訂的審核路徑**無聲變成預設路徑**。至少應記入 logger（有 Sentry）讓異常可見。

---

## 建議修復順序

1. **忘打卡整條鏈（M1–M4）**——M1/M2 表示核准路徑當前根本是壞的（必然 500 或寫壞資料），一起修一次驗證：組合完整時間戳 + 統一 workDate 轉換 + 核准後重算工時 + 撤銷回復。約 2–3 天。
2. **P1 凍結 guard（六條撤銷路由）**——共用 guard 半天可上，立即堵住凍結繞過。
3. **L5 補休假核准扣減 + O1 補休回沖失敗處理 + P2 已發薪警示**——補休帳務正確性一組修：核准掛帳、撤銷回沖、失敗告警、存量差額盤點。約 2 天。
4. **W1 設定覆蓋（忘打卡/調班接設定）+ W3 三階確認**——消除「設定了沒用」與顯示不一致。
5. **調班 S1–S3**——S2/S3 小修快做（改用 ShiftDefinition + 去 fallback）；S1 加欄位遷移可排後。
6. **L4、W2、其餘低項**見縫插針。

**共通模式提醒**：本次六個模組反覆出現同兩類根因——(1) **核准會寫入衍生資料，撤銷不會收回**（班表、考勤時間、補休、工時）；(2) **撤銷路徑缺少主流程都有的防護**（凍結、設定、驗證）。修復時建議為「核准↔撤銷對稱性」建立 checklist，新申請類型上線前逐項核對。
