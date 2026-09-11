# 考勤記錄參數與數據 Bug 稽核（第十三份）

> 產出日期：2026-07-12
> 稽核範圍：考勤記錄 API（`api/attendance/records/route.ts`，696 行——正常工時、加班時數、顯示狀態、統計摘要）、今日摘要（`api/attendance/today-summary/route.ts`，239 行——個人工時卡與管理端今日統計）。
> 前置文件：第八份（計算核心 B 系列）——本文件聚焦**記錄呈現層的參數正確性**，計算核心問題以 B 編號引用不重複。

## 先說做對的部分（修復時不要動壞）

這條路由明顯經過近期重構，多處品質高於全系統平均：

- **日期參數台灣錨定且有 round-trip 驗證**（`parseDateQueryParam` 用 `getTaiwanDayStart` + 反查驗證，`records/route.ts:30-56`）。
- **班表配對型別分流正確**（`toWorkDateKey` 對 Date/String 各走正確轉換，L22-28）——DateTime 的考勤記錄與 String 的班表在台灣日期字串上正確對齊。
- **加班顯示已對齊核准值**（L535-545,564 走 `resolveApprovedAttendanceOvertime`）——第八份 B9 指出的「顯示未過濾加班」在 records 端**已修復**。
- **統計加總與單筆同口徑**（L604-671 的 summary 對每筆用同一套 `getStoredOrCalculatedAttendanceHours` + 核准過濾 + 同一狀態機）。
- **GPS/打卡原因欄位有權限過濾**（僅 ADMIN/HR 可見，L579-590）。

## 問題總表

| # | 問題 | 嚴重度 | 觸發條件 |
|---|------|--------|----------|
| AR1 | 「異常」判定以 workHours 為門檻——假日加班、半天假、天災假、部分工時**全被標異常** | **高** | 每次上述情境打卡 |
| AR2 | 顯示層遲到/早退是**第三套**實作且無跨日——夜班遲到顯示「正常」，與全勤扣款矛盾 | **高** | 夜班遲到/早退 |
| AR3 | 今日統計（管理端）是**第四套**判定：班表開始 1 分鐘即計「缺勤」；天災假日全員被統計成缺勤 | **高** | 每日管理端儀表板 |
| AR4 | today-summary 的加班**未**對齊核准值——打卡頁與記錄頁數字不一致 | 中 | 有未核准的班外時數時 |
| AR5 | 狀態/加班篩選走全量載入 + 逐筆重算 | 中（效能） | 管理員大範圍篩選查詢 |
| AR6 | 三種「狀態」並存：DB `status` 欄位（恆 PRESENT）、records 動態狀態、今日統計口徑 | 中 | 恆常（口徑混亂） |
| AR7 | 上游髒資料污染統計（B1 夜班孤兒、第九份 M2 補卡重複記錄） | 中（連鎖） | 上游 bug 修復前 |
| AR8 | 回應缺 `totalHours`——前端只能以 regular+overtime（核准後）相加，與打卡時距對不上 | 低 | 員工對帳時 |
| AR9 | `workHours=0` 使全部時數變加班（B10 同款，today-summary 呼叫端） | 低（引用） | 班表 workHours 為 0 |

---

## 高嚴重度

### AR1 「異常」判定以 workHours 為門檻，誤傷四類合法出勤

**位置**：`records/route.ts:519`（`MIN_WORK_HOURS = 8`）、`:202`（`minimumWorkHours = hasSchedule ? (schedule.workHours ?? 0) : fallback`）、`:245-247`（`totalHours < minimumWorkHours → '異常'`）

**現象**：只要當日總工時低於「班表 workHours（無班表時 8）」，顯示狀態一律「異常」。四類合法情境全中：

| 情境 | 判定過程 | 顯示 |
|------|----------|------|
| 假日/OFF 日加班 3 小時（無班表） | 無班表 → 門檻 fallback **8**；3 < 8 | **異常** |
| 半天請假、下午上班 4 小時 | FDL 班表 workHours 未清（B3/B7）→ 門檻 8；4 < 8 | **異常** |
| 天災假半天停班、上班半天 | TD 班表 workHours 未清（第十一份 SC4）→ 門檻 8 | **異常** |
| 部分工時員工 4 小時班 | 若班表 workHours 正確為 4 → 正常 ✓；但無班表時 → 門檻 8 | **異常** |

員工每次合法的短時數出勤，記錄頁都標紅「異常」——長期下來「異常」失去警示意義（狼來了效應），真異常反而被淹沒。

**修正方向**：(1) 無班表出勤改標「無班表出勤」中性狀態（它需要的是管理員留意，不是異常紅標）；(2) 門檻比對排除 `TD`/`FDL` 班別（或等 B3/SC4 修復 workHours 歸零後自然正確——但防禦性排除仍建議）；(3) 門檻設定容忍值（如 workHours × 0.9）避免 0.01 小時的四捨五入誤差觸發異常（B12 連動）。

### AR2 顯示層遲到/早退是第三套實作，夜班全漏且與全勤矛盾

**位置**：`records/route.ts:204-235`（`checkLateOrEarly`——僅比較台灣「時:分」，無跨日位移）

**現象**：全系統現在有**三套**遲到/早退判定，行為互不相同：

| 實作 | 跨日處理 | 夜班 00:30 遲到上班（班 22:00） | 夜班 23:50 早退（班到 06:00） |
|------|----------|----------------------------------|-------------------------------|
| `perfect-attendance.ts`（全勤，2026-07-02 新增） | **有**（+24h 位移） | 判遲到 → 扣 0.5 天獎金 | 判早退 → 扣 0.5 天 |
| `payroll-processing.ts`（扣薪，B2） | 無 | 漏 | 漏 |
| `records/route.ts`（顯示） | 無 | **顯示「正常」** | **顯示「正常」** |

最壞的組合已經成立：夜班員工月底發現全勤獎金被扣 0.5 天（判遲到），打開考勤記錄頁查證——**該日顯示「正常」**。員工拿著顯示「正常」的紀錄申訴，HR 拿著全勤模組的判定各說各話。

**修正方向**：第八份 B2 已建議抽單一共用判定函式——本項確認需求擴大為**三處共用**（全勤已有正確的跨日版本，抽出即可）；顯示層與扣款層必須同源，這是申訴對帳的基本要求。

### AR3 今日統計是第四套判定：開班 1 分鐘即「缺勤」、天災假日全員缺勤

**位置**：`today-summary/route.ts:142-167`（管理端今日統計）

三個問題疊加：

1. **「缺勤」定義過激**（L164）：有班表、還沒打上班卡、現在時間 ≥ 班表開始——**開始後 1 分鐘**就計入 absentCount。早上 09:01 管理員看儀表板，所有在電梯裡、剛到門口的人都是「缺勤」。無任何寬限。
2. **第四套遲到判定**（L158）：`getTaiwanTimeMinutes(clockInTime) > scheduleStartMinutes`——again 無跨日，夜班統計失真（與 AR2 並列第四種行為）。
3. **天災假日全員缺勤**（連鎖第十一份 SC2）：TD 全日停班班表為 `00:00–23:59`——`isWorkingSchedule` 不排除 TD、start 00:00 解析有效、`currentMinutes >= 0` 恆真 → 停班日**所有依公告未出勤的員工都被統計為缺勤**，儀表板顯示全公司大缺勤。

**修正方向**：(1) absentCount 更名「尚未打卡」或加寬限（班表開始 + N 分鐘）；(2) 判定共用 AR2 的統一函式；(3) `isWorkingSchedule` 排除 TD/FDL（與第十一份 SC5 同一修）。

---

## 中嚴重度

### AR4 today-summary 加班未對齊核准值

**位置**：`today-summary/route.ts:88`（直接用 `calculateAttendanceHours` 的原始 `overtimeHours`）vs `records/route.ts:535-545,564`（已過 `resolveApprovedAttendanceOvertime`）

B9 修復只做了一半：records 頁顯示核准後加班（正確），打卡頁的今日摘要仍顯示未過濾原始值。員工下班打卡看到「今日加班 1.5 小時」，隔天到記錄頁變 0（無核准加班單）——同一數字兩頁兩個值，是加班爭議的直接火種。

**修正方向**：today-summary 套用與 records 相同的 `resolveApprovedAttendanceOvertime`（當日核准加班單一筆查詢，成本低）；或至少在打卡頁標示「未含核准審核」。

### AR5 狀態/加班篩選走全量載入

**位置**：`records/route.ts:416,437-438`（`shouldFilterInMemory` 時 `findMany` 無分頁）

以「遲到」或加班區間篩選時，因狀態是動態算的，實作選擇**全量載入 + 逐筆重算 + 記憶體過濾再分頁**。個人查詢量小沒事；管理員跨年度全公司篩「遲到」→ 數萬筆記錄進記憶體、每筆做班表配對與工時重算。正確性沒問題（口徑一致），純效能瓶頸。

**修正方向**：短期可接受（資料量百人級）；中期若變慢，將顯示狀態在寫入時物化（denormalize 一個 displayStatus 欄位，狀態機變更時批次重算）——但這與 B8 的「儲存 vs 重算」策略決策綁定，建議一起定案。

**2026-07-12 已處理**：新增 `attendance_records.display_status` 物化欄位與索引；狀態篩選先用 `displayStatus IN (...) OR displayStatus IS NULL` 縮小 DB 查詢，再以既有狀態機重算校正並 lazy backfill。班表新增、更新、刪除會透過 trigger 將同員工同台灣工作日的物化狀態清空，避免班表變更後狀態失真。加班時數篩選仍保留動態重算，因它依賴核准加班單口徑。

### AR6 三種「狀態」並存

- DB `AttendanceRecord.status`：恆為 `PRESENT`（B4——無人寫 ABSENT），today-summary 還把它回傳給前端（L190,221）。
- records 顯示狀態：動態判定（正常/遲到/早退/缺勤/異常）。
- today-summary 統計：自己的 late/absent 口徑（AR3）。

同一個「狀態」概念三個來源三種答案。**修正方向**：DB status 欄位要嘛廢棄（顯示全走動態），要嘛由每日 cron 物化動態狀態進去（與 B4 曠職推導同一機會）——二擇一，不要三軌並存。

### AR7 上游髒資料污染統計（連鎖，引用）

- **B1 夜班孤兒記錄**（只有下班卡）→ 顯示「異常」、totalRecords 計入。
- **第九份 M2 補打卡重複記錄**（UTC 午夜 workDate）→ `toTaiwanDateStr` 後與原記錄同一台灣日——**列表同日兩筆**、統計筆數虛增、一筆有上班卡一筆有下班卡各自算不出工時。

records API 本身無法防禦（資料就是髒的），但可加**同日重複偵測**：同一 employeeId + 台灣日出現多筆時在回應標記 `duplicated: true`，前端顯示警示——讓髒資料可見，而不是安靜地算錯。上游修復（B1、M2）後跑一次資料清理。

**2026-07-12 已處理**：考勤記錄 API 會以 `employeeId + 台灣工作日` 計算重複筆數，回應每筆新增 `duplicated` 布林欄位；同日多筆時全部標為 `true`，供前端顯示髒資料警示。

---

## 低嚴重度

### AR8 回應缺 totalHours

單筆回應只有 `regularHours` 與 `overtimeHours`（核准後）——兩者相加 ≠ 實際打卡時距（班外未核准時數被剪掉）。員工「我打了 10 小時卡為什麼只有 8.5」的疑問無從在頁面上自解。建議回傳 `totalHours`（打卡時距扣休息）並在前端標示三個數字的口徑：總時數／正常工時／核准加班。

### AR9 workHours=0 全變加班（B10 引用）

today-summary 與 clock 路由同款 `todaySchedule?.workHours ?? undefined`——workHours 為 0 時 standardHours=0，全部時數進 overtimeHours。已列第八份 B10，此處僅補充：records 端經 `getStoredOrCalculatedAttendanceHours` 的 `scheduledWorkHours || STANDARD_REGULAR_HOURS`（`work-hours.ts:128`）——`||` 對 0 落到預設 8，**與 clock 端的 `??`（保留 0）行為不同**：同一筆記錄打卡當下與事後查詢的工時可能不同。修 B10 時兩處語意需統一。

---

## 建議修復順序

1. **AR2 + AR3-2：遲到/早退判定統一**——抽 `perfect-attendance.ts` 的跨日版本為共用函式，records／payroll（B2）／today-summary 三處替換。1 天，一次消滅「四套實作」。
2. **AR1：異常門檻語意修正**（無班表出勤中性化 + 排除 TD/FDL + 容忍值）——半天。
3. **AR3-1/-3：缺勤口徑與 TD 排除**——半天（與第十一份 SC5 同批）。
4. **AR4：today-summary 對齊核准加班**——半天。
5. **AR6/AR7**：狀態欄位定案 + 重複偵測——各半天。
6. **AR5/AR8/AR9** 見縫插針或併入相關決策（B8、B10）。

## 與系列文件的關聯

- 本文件是第八份「計算核心」的**呈現層對應篇**：B 系列修計算，AR 系列修「員工和管理員實際看到的數字」。兩層必須同源——AR2 的申訴矛盾（全勤扣款 vs 顯示正常）就是兩層不同源的代價。
- AR1/AR3 的一半根因在第十一份（TD/FDL 的 workHours 與時間未清）——天災假統一修法落地後，本文件的病徵自動消失一半，但防禦性排除仍建議保留。
- 遲到/早退「四套實作」清單：`perfect-attendance.ts`（有跨日 ✓）、`payroll-processing.ts`（B2）、`records/route.ts`（AR2）、`today-summary/route.ts`（AR3）——統一函式是本系列反覆出現的第一優先重構。
