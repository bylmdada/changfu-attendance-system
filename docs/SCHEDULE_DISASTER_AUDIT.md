# 班表建立／班表確認／天災假／工時總結 Bug 稽核（第十一份）

> 產出日期：2026-07-09
> 稽核範圍：班表建立（`api/schedules`）、班表確認（`api/schedule-confirmation`，1013 行）、天災假（`api/disaster-day-off`，747 行）、個人班表工時總結（`api/my-schedules`）、以及以上對薪資計算（`src/lib/payroll-processing.ts`）與全勤（`perfect-attendance.ts`）的影響鏈。
> 前置文件：第八份（考勤計算）、第九份（申請模組）——本文件的 B 編號引用第八份。

## 核心結論

**天災假是「用班表欄位存停班資訊」的設計**——設立時把班別改成 `TD`、把「停班時窗」寫進 `startTime`/`endTime`，但 `workHours` 原封不動。問題在於：全系統（薪資扣薪、全勤、工時計算）都把 `startTime`/`endTime` 當**上班時窗**、把 `workHours` 當**應上工時**讀——天災假日因此在下游被當成正常上班日計算。加上班表確認的失效機制只覆蓋一條修改路徑，「已確認的班表」實際上隨時可被靜默改動。

## 問題總表

| # | 問題 | 嚴重度 | 觸發條件 |
|---|------|--------|----------|
| SC1 | 天災假日在薪資扣薪端被當正常班——颱風天合法未打卡 = 缺勤全日扣薪 | **高** | 考勤扣薪功能啟用 + 天災假日 |
| SC2 | 半天停班寫入的是「停班時窗」，被當「上班時窗」讀——當日所有時間比對顛倒 | **高** | 設立 AM/PM 半天停班 |
| SC3 | 班表確認失效只覆蓋排班管理——天災假/請假/調班/模板/複製改班表都不失效確認 | **高** | 確認後班表被上述任一路徑修改 |
| SC4 | 天災假日 workHours 未清——個人工時總結與預期工時虛增 | **高** | 每次設立天災假 |
| SC5 | 全勤計算不認識 TD——半天停班日打卡產生誤遲到/早退扣獎金 | 中 | 半天停班日有打卡 |
| SC6 | 班表手動更新 workHours 與起訖時間無一致性驗證 | 中 | 手動編輯班表 |
| SC7 | 排定加班（Schedule.overtimeHours）與實際加班（AttendanceRecord.overtimeHours）同名並存，工時總結回傳排定值 | 中（語意檢查點） | 恆常 |
| SC8 | 確認截止時間用伺服器時區——台灣次月 1 日早上 8 點前仍可確認 | 低 | 每月月底 |
| SC9 | `toDateOnly` 用 `toISOString` 取日期——時區語意錯誤的工具（目前恰好沒踩到） | 低（防禦性） | 未來誤用時 |
| SC10 | 停班時窗以 `23:59` 表示日終——1 分鐘縫隙 + 顯示怪異 | 低 | 顯示層 |

## 先說做對的部分（修復時不要動壞）

- **天災假有快照與還原**：`originalSchedules` JSON 快照、刪除時還原、還原前檢查班表是否已被他人改動（`DISASTER_DELETE_CONFLICT`）——比請假模組的 FDL 覆蓋（B3，無備份無還原）好得多。
- **班表建立有 ShiftDefinition 欄位同步**（`buildSyncedShiftFields`）與 dry-run 覆蓋確認（第四份已完成項）。
- **班表確認在排班管理路徑有失效設計**（`invalidateConfirmation`，新增/更新/批次三處）——問題只在覆蓋面（SC3）。
- **確認的月份範圍用字串比對**（`getMonthDateRange` 回 YYYY-MM-DD 字串，與 `Schedule.workDate` String 型別一致）——無 UTC 月界問題。

---

## 高嚴重度

### SC1 天災假日在薪資扣薪端被當正常班

**位置**：寫入端 `api/disaster-day-off/route.ts:461-482`（只改 `shiftType: 'TD'` + 時間，不動 workHours）；消費端 `src/lib/payroll-processing.ts:786-804`（扣薪班表查詢條件**只有** `workHours: { gt: 0 }`）＋ `:441-447`（時間可解析就不跳過）

**現象**：考勤扣薪的班表查詢不排除 `TD` 班別；FDL（請假）能逃過是因為時間被清空（解析失敗 → continue），但 TD 寫入的是**可解析的時間**（FULL：00:00–23:59）且 workHours 保留原值（如 8）。

**重現情境**（考勤扣薪啟用時）：
1. 7/15 颱風停班，管理員設立天災假 → 班表變 TD 00:00–23:59、workHours 仍為 8。
2. 員工依公告未上班、未打卡。
3. 月底薪資計算：該日「有班（workHours 8 > 0）、時間可解析、無打卡」→ **狀態=缺勤，扣 8 小時 × 時薪**。

**修正方向**：見文末「天災假統一修法」。短期急救：扣薪查詢加 `shiftType: { notIn: ['TD', 'FDL', 'OFF'] }`。

### SC2 半天停班的時窗語意顛倒

**位置**：`api/disaster-day-off/route.ts:115-118`

```ts
startTime: stopWorkType === 'FULL' ? '00:00' : (stopWorkType === 'AM' ? '00:00' : '12:00'),
endTime:   stopWorkType === 'FULL' ? '23:59' : (stopWorkType === 'AM' ? '12:00' : '23:59')
```

寫入的是**停班的時窗**（AM 停班 → 00:00–12:00）。但班表的 `startTime`/`endTime` 在全系統的語意是**上班時窗**：

| 情境：上午停班（AM），員工下午 13:00 上班 | 系統實際判定 |
|---|---|
| 全勤比對（`perfect-attendance.ts:137`）：clockIn 13:00 > 班表 start 00:00 | **遲到 → 扣 0.5 天全勤** |
| 工時計算（`work-hours.ts:97`）：打卡 13:00–17:30 與「班表窗口 00:00–12:00」重疊 = 0 | **regularHours = 0，整個下午白做** |
| 考勤扣薪（`payroll-processing.ts:465`）：clockOut 17:30 < 班表 end 12:00？否 → 但 clockIn 13:00 > start 00:00 | **遲到 780 分鐘 → 扣 13 小時薪** |

半天停班日**有來上班的員工反而被系統重罰**。PM 停班（寫入 12:00–23:59）同理顛倒。

**修正方向**：半天停班應寫入「實際要上班的時窗」（AM 停班 → 下午班時窗，如 13:00–17:30）並將 workHours 減半；停班時窗資訊留在 `DisasterDayOff` 記錄本身（`stopWorkType` 已足以表達），不塞進班表。

### SC3 班表確認失效只覆蓋一條修改路徑

**位置**：`invalidateConfirmation`（`src/lib/schedule-confirm-service.ts`）——全站僅 `api/schedules/route.ts` 呼叫（三處：新增 L719-723、更新 L947-949、批次 L1156）。已 grep 確認其他路徑**零呼叫**。

**繞過清單**（都會修改 Schedule，都不失效確認）：

| 路徑 | 修改內容 |
|------|----------|
| `api/disaster-day-off`（設立/編輯/刪除） | shiftType → TD、時間改寫、還原 |
| `api/leave-requests/[id]`（請假核准） | shiftType → FDL、清空時間 |
| `api/shift-exchanges/[id]`（調班核准） | 班別與時間改寫 |
| `api/shift-exchange-requests/[id]/cancel、void`（調班撤銷） | 班別還原 |
| `api/schedules/apply-template`、`api/schedules/copy` | **獨立路由檔**，批次寫入班表 |

**後果**：員工簽名確認的班表，可在確認後被以上任一路徑改動而確認紀錄依然顯示「已確認」——確認制度的法律/管理意義（員工知悉並同意班表）被架空。尤其 `apply-template`/`copy` 是排班管理自家功能，漏接純屬 oversight。

**修正方向**：`invalidateConfirmation` 的呼叫下沉為共用行為——最省是抽一個 `updateScheduleWithInvalidation` helper，或在上述六個路徑各補一行呼叫。天災假/請假這類「非排班意圖」的變動是否該失效確認，可與業務確認（也許改為「標記確認後有變動」而非失效重簽）。

### SC4 天災假日 workHours 未清——工時總結虛增

**位置**：寫入端同 SC1；消費端 `api/my-schedules/route.ts:27-37`（`calculateExpectedWorkHours = workHours + specialLeaveHours + compLeaveHours`）

天災假日的 workHours 保留原值，個人班表查詢的「預期工時」照算 8 小時：

- 員工看月工時總結：颱風月的預期工時與別月相同——若 UI 有「預期 vs 實際」對照，颱風天顯示缺 8 小時，員工誤以為自己有缺勤。
- 任何以 `schedule.workHours` 聚合的報表（薪資端 `deductibleScheduledHours`、班表 Excel 匯出的工時欄）都含天災假日的虛工時。

**修正方向**：與 SC1/SC2 一併處理——天災假設立時 FULL 停班 workHours 歸零、半天停班減半（快照已存原值可還原，`originalSchedules` 需**擴充存 workHours/breakTime**，目前快照只存 shiftType/startTime/endTime——不擴充的話還原時 workHours 回不來）。

---

## 中嚴重度

### SC5 全勤計算不認識 TD

**位置**：`src/lib/perfect-attendance.ts:112-114`（`isWorkingSchedule` 只排除 `shiftType !== 'OFF'`）

TD 班別有 startTime/endTime → 被當工作班納入遲到/早退判定。全日停班無打卡不觸發（無考勤記錄），但**半天停班日有打卡就中 SC2 的顛倒時窗**：下午上班判遲到、扣 0.5 天全勤獎金。另外天災假日仍計入應出勤天數分母（B5 的「週一至五」算法連動——颱風天算應出勤日，全員出勤率被稀釋）。

**修正方向**：`isWorkingSchedule` 排除清單加 `TD`、`FDL`（FDL 目前靠空時間僥倖跳過，明確排除更穩）；B5 修分母時把天災假日一併排除。

### SC6 班表手動更新無一致性驗證

**位置**：`api/schedules/route.ts:823`（`parseHour(body.workHours)`）、`:917`（直接寫入）

手動編輯班表可單獨改 `workHours` 而不動起訖時間（或反之）——無「時距 − 休息 ≈ workHours」的交叉驗證。下游把 workHours 當 `standardHours`（打卡工時計算 `clock/route.ts:334`）、當 `deductibleScheduledHours`（扣薪）——時間寫 09:00–18:00 但 workHours 誤填 4 → 該員工每天「加班」4 小時（工時計算 standardHours=4）。歷史上 breakTime 曾出過同款不一致（`repair-schedule-break-time-cli.ts` 的存在即證據）。

**修正方向**：更新時驗證 `(endTime − startTime − breakTime)` 與 workHours 差異超過容忍值（如 0.5h）即警告或拒絕；批次同步路徑（buildSyncedShiftFields）已一致，只需守手動路徑。

### SC7 排定加班與實際加班同名並存（語意檢查點）

**位置**：`prisma/schema.prisma:555`（`Schedule.overtimeHours`）vs `AttendanceRecord.overtimeHours`；`api/my-schedules/route.ts:162,177` 回傳的是**班表上的排定值**

個人班表查詢的「加班時數」是排班時預排的加班，不是打卡算出的實際加班（AttendanceRecord.overtimeHours，且後者又有 B9 的未過濾問題）。三個「加班時數」（排定、打卡計算、核准加班單）在不同頁面出現而 UI 未必標明語意——員工對帳時三個數字對不上。

**修正方向**：確認 my-schedule 頁「加班時數」區塊的語意標示；長期統一顯示「核准加班單」口徑（與薪資實發一致，B9 同方向）。

---

## 低嚴重度

### SC8 確認截止時間用伺服器時區

**位置**：`api/schedule-confirmation/route.ts:29-33`（`new Date(year, month, 0, 23:59:59)` 本地建構）、`:882`（deadline 比較）

UTC 伺服器上 deadline = UTC 月末 23:59:59 = **台灣次月 1 日 07:59:59**——員工次月 1 日早上仍可確認上月班表。偏寬鬆、無資損，但與「月底截止」的字面規則差 8 小時。修正：用 `timezone.ts` 的 `getTaiwanMonthEnd`。

### SC9 `toDateOnly` 的時區語意錯誤（防禦性）

**位置**：`api/my-schedules/route.ts:39-41`（`date.toISOString().split('T')[0]` = UTC 日期）

目前只用於 Holiday 對映，而 Holiday.date 恰為 UTC 午夜錨定所以結果正確——但這是**巧合正確**：同一工具拿去處理台灣午夜錨定的 `AttendanceRecord.workDate` 就會錯一天（B 系列的既有地雷模式）。應改用 `timezone.ts` 的 `toTaiwanDateStr`（對 UTC 午夜的假日同樣正確：UTC 00:00 = 台灣 08:00 同日）。

### SC10 停班時窗 `23:59` 表示日終

`getStopWorkScheduleTimes` 用 23:59 表示一天結束——留 1 分鐘縫隙且顯示怪（員工看到班表「00:00–23:59」）。採納「天災假統一修法」後此函式退役，自然消失。

---

## 天災假統一修法（SC1/SC2/SC4/SC5 一次解）

天災假的根本問題是**把「停班資訊」塞進「上班時窗」欄位**。建議一次修正寫入語意：

1. **FULL 停班**：班表改 `shiftType: 'TD'`、`startTime: ''`、`endTime: ''`、`workHours: 0`——與 FDL 同款「非工作日」表示法，下游（扣薪的時間解析跳過、工時計算的無班表分支、全勤的空時間）**全部自動正確**，不需逐一改消費端。
2. **AM/PM 半天停班**：寫入**實際上班時窗**（依原班表切半）＋ workHours 減半；停班時窗不進班表（`DisasterDayOff.stopWorkType` 已承載此資訊，顯示層要標示「上午停班」從 DisasterDayOff 查）。
3. **快照擴充**：`originalSchedules` 加存 `workHours`、`breakTime`（目前只存 shiftType/times——改了 workHours 之後，不擴充就還原不回來）。
4. **防禦層**：即便如此，扣薪查詢與 `isWorkingSchedule` 仍建議明確排除 `TD`/`FDL`（SC1 短期急救 + SC5），不依賴「空時間剛好解析失敗」的僥倖。
5. **失效確認**：天災假設立/刪除呼叫 `invalidateConfirmation`（或依業務決定改用「確認後變動」標記）——SC3 的一部分。

**存量修復**：已設立的天災假記錄需以 migration 重寫班表（FULL → 清空+歸零；半天 → 正確時窗），快照同步補欄位。

## 建議修復順序

1. **SC1 短期急救**（扣薪查詢排除 TD/FDL/OFF）——一行 where 條件，先擋住颱風天扣薪。半天。
2. **天災假統一修法**（SC1 根治 + SC2 + SC4 + SC10）＋ 存量 migration——1–2 天。
3. **SC3 確認失效覆蓋**（六路徑補呼叫或抽 helper）——1 天。
4. **SC5 全勤排除 TD/FDL** ＋ **SC6 手動更新驗證**——各半天。
5. **SC7 語意確認、SC8/SC9 低項**見縫插針。

## 與前三份稽核的關聯

- SC1/SC2/SC4 是第八份 B 系列（工時計算基準）在天災假場景的具體爆發——`startTime`/`endTime`/`workHours` 是全系統的計算基準欄位，**任何往班表寫入非上班語意資料的功能都會污染下游**（FDL 用清空逃過、TD 用有效時間直接中彈）。
- SC3 與第九份的共通根因二（「旁路修改缺少主流程都有的防護」）同款——invalidateConfirmation 是防護，五條旁路都沒接。
- 修復天災假時，第八份 B3（請假清空班表）建議一併考慮——兩者最終都指向同一個結構解：**班表欄位只放上班資訊，請假/停班資訊放各自的表，計算時疊加**。
