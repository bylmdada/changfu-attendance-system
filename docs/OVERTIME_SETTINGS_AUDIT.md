# 加班費計算設定 Bug 稽核（第十四份）

> 產出日期：2026-07-12
> 稽核範圍：系統設定 → 薪資計算 → 加班費計算設定（`api/system-settings/overtime-calculation`，231 行）、設定服務（`src/lib/overtime-settings.ts`）、最小單位（`src/lib/overtime-hours.ts`、`approved-overtime.ts`）、兩套費率引擎（`src/lib/overtime-calculator.ts`、`src/lib/salary-utils.ts`）及其消費鏈。

## 核心結論：設定頁大部分是假儀表板

加班費計算設定共 **17 個欄位**，逐一 grep 消費端後：**13 個全站零消費**——管理員在設定頁調整費率、上限、擬制工時，存進資料庫、有稽核紀錄、有範圍驗證，然後**沒有任何計算讀它們**。實際費率硬編碼在兩個檔案裡（且兩處行為不一致）。

### 欄位消費對照表（已逐一核實）

| 設定欄位 | 消費端 | 狀態 |
|----------|--------|------|
| `overtimeMinUnit`（加班最小單位） | records／today-summary／overtime-requests／payroll-processing 等 8 處 | ✅ **有效** |
| `compensationMode`（補償模式） | `payroll-processing.ts`（EMPLOYEE_CHOICE 分流） | ✅ 有效 |
| `monthlyBasicHours`（月基本工時） | **零消費**（時薪權威改為薪資檔 `hourlyRate`，未設定時月薪 ÷ 240） | ❌ 裝飾品 |
| `description` | 顯示用 | ✅ |
| `weekdayFirstTwoHoursRate` 等 **6 個費率欄位** | **零消費** | ❌ 裝飾品 |
| `weekdayMaxHours` 等 **4 個上限欄位** | **零消費** | ❌ 裝飾品 |
| `restDayMinimumPayHours`（做 1 算 4） | **零消費** | ❌ 裝飾品 |
| `isEnabled`（啟用開關） | **零消費** | ❌ 裝飾品 |
| `settleOnResignation`（離職結清） | **零消費**（離職結算依補休餘額與薪資檔時薪計算，沒讀這個開關） | ❌ 裝飾品 |

## 問題總表

| # | 問題 | 嚴重度 |
|---|------|--------|
| OT1 | 13/17 設定欄位零消費——費率、上限、開關調了全部無效 | ✅ 已修 |
| OT2 | 兩套費率引擎並存且行為不一致：一套含 2018 已廢止的休息日擬制工時（多付），一套核實計算 | ✅ 已修 |
| OT3 | 設定欄位結構與法定費率分界不符（8 小時 vs 法定 2 小時）——未來接線即少付、違法 | ✅ 已修 |
| OT4 | 最小單位無條件進位 + 多筆核准單逐筆進位膨脹 | ✅ 已修 |
| OT5 | 時薪換算三軌：硬編碼 ÷240／薪資檔 hourlyRate／設定 monthlyBasicHours | ✅ 已修 |
| OT6 | 驗證細節：`\|\| fallback` 使合法輸入 0 被靜默改為原值 | ✅ 已修 |
| OT7 | 設定顯示 1.34/1.67，實算 4/3、5/3——兩者對不上 | ✅ 已修 |

---

## 高嚴重度

### OT1 設定與實作脫鉤：13 個欄位是裝飾品

**位置**：設定寫入 `api/system-settings/overtime-calculation/route.ts:153-208`（驗證完整、有稽核）；消費端 grep 結果如上表

**現象**：管理員把平日加班倍率從 1.34 調到 1.5 → 存檔成功、稽核有紀錄 → **加班費一毛不變**，因為實際費率硬寫在：

- `src/lib/salary-utils.ts:12-14`：`WEEKDAY_FIRST_TWO_HOURS_RATE = 4/3`、`5/3`、`8/3`（核准加班單時計算 overtimePay 用）
- `src/lib/overtime-calculator.ts`：4/3、5/3、8/3 直接寫在函式內 + `calculateHourlyWage = 月薪 ÷ 240`（payroll-calculator 用）

上限四欄位（weekdayMaxHours 等）同樣無人讀——加班上限的實際管控在別處（`overtime-limit` 設定與申請驗證），兩套上限設定並存且這套是死的。`isEnabled` 關掉也不會停用任何計算。`settleOnResignation` 關掉，離職結算照樣結清。

**危害**：不只是無效——是**誤導**。管理員以為調了生效（UI 顯示已儲存 + 稽核有紀錄），實際員工薪資照舊算。若有一天公司真的依設定頁「調整」了費率並據此對外承諾，實付與承諾不符。

**修正方向**（二擇一，誠實原則）：
1. **接線**：兩套引擎合併為一套並改吃設定值（工作量大，見 OT2/OT3 的前置問題）。
2. **砍欄位**：設定頁只保留真正生效的（最小單位、補償模式、月基本工時），其餘欄位移除或標示「唯讀，依勞基法固定」——半天工作量，立即消除誤導。**建議先做 2，再議 1**。

**2026-07-12 已處理**：採方案 2。設定頁只送出已接入流程的欄位（`compensationMode`、`overtimeMinUnit`、`description`）；費率、每日上限、月基本工時、離職補休結算開關改為不可編輯說明。API 端同步忽略上述死欄位的 POST 覆寫，避免 UI 以外的呼叫者仍能存入「看似成功但實算不變」的設定。

### OT2 兩套費率引擎行為不一致，其一含已廢止的擬制工時

**位置**：`overtime-calculator.ts:112-180`（`calculateRestDayOvertime`）vs `salary-utils.ts:106-120`

同一筆「休息日加班 3 小時」：

| 引擎 | 休息日計法 | 3 小時實付 |
|------|-----------|-----------|
| `overtime-calculator.ts` | **擬制工時**：≤4h 算 4h、≤8h 算 8h、上限 12h | 按 **4 小時**付（2h×4/3 + 2h×5/3） |
| `salary-utils.ts` | **核實計算**：做多少算多少 | 按 **3 小時**付（2h×4/3 + 1h×5/3） |

兩個問題：

1. **不一致**：核准加班單當下算的金額（salary-utils，batch-approve 呼叫）與 payroll-calculator 引用 calculator 的口徑可能不同——同一筆加班在不同流程算出不同錢。實際哪個數字進薪資需以 `payroll-processing` 的取數路徑定案（若薪資直接用核准單上存的 `overtimePay`，則 salary-utils 為實際權威、calculator 淪為僅提供 `calculateHourlyWage`）。
2. **擬制工時是舊法**：休息日「做 1 算 4、做 5 算 8」係勞基法 24 條舊制，**2018 年 3 月修法後改為核實計算**。calculator 保留擬制 = 優於法令（多付），合法但雇主應知情且大概率非故意；`restDayMinimumPayHours` 設定欄位（預設 4）就是為擬制而生——而它零消費，佐證這條路徑從未被有意識地維護。

**修正方向**：與 HR 確認休息日口徑（核實 or 優於法令擬制）→ 淘汰其中一套引擎 → 留下的那套接設定（或明確硬編碼 + 設定頁移除對應欄位）。

**2026-07-12 已處理**：休息日加班費統一改為核實計算，移除 `overtime-calculator.ts` 的「4 小時內算 4 小時、8 小時內算 8 小時」舊制擬制工時，讓 payroll calculator 使用的費率引擎與 `salary-utils.ts` 口徑一致。休息日 3 小時現在為前 2 小時 4/3 倍 + 第 3 小時 5/3 倍，不再多算成 4 小時。

### OT3 設定欄位結構與法定分界不符——接線陷阱

**位置**：`overtime-settings.ts:12-13`（`restDayFirstEightHoursRate: 1.34`、`restDayAfterEightHoursRate: 1.67`）

設定把休息日費率以「**前 8 小時／8 小時後**」分界；但法定分界是「**前 2 小時 ×4/3，第 3 小時起 ×5/3**（第 9 小時起 ×8/3）」。兩套硬編碼引擎目前都寫對了法定的 2 小時分界——設定欄位反而是錯的結構。

**危害**：現在因 OT1（零消費）而無實害；但**一旦有人把設定接上線**且照欄位名實作（前 8 小時全用 1.34）→ 休息日第 3–8 小時每小時少付 0.33 倍 → **低於法定，違法**。這是埋給未來修 OT1 的人的地雷。

**修正方向**：修 OT1 時同步重構欄位為法定結構（`restDayFirstTwoHoursRate`／`restDayHours3To8Rate`／`restDayAfterEightHoursRate`），不要沿用現有欄位名接線。

**2026-07-12 已處理**：`overtime-settings.ts` 已移除 `restDayFirstEightHoursRate`，改為 `restDayFirstTwoHoursRate`、`restDayHours3To8Rate`、`restDayAfterEightHoursRate`。`normalizeOvertimeCalculationSettings` 會丟棄舊 JSON 的 `restDayFirstEightHoursRate` 與外部傳入的休息日費率覆寫，固定回法定分界 4/3、5/3、8/3，避免未來接線時沿用「前 8 小時」錯誤欄位。

---

## 中嚴重度

### OT4 最小單位無條件進位 + 逐筆進位膨脹

**位置**：`overtime-hours.ts`（`roundOvertimeHoursToUnit` 用 `Math.ceil`）；`approved-overtime.ts:49,88`（raw 與每筆核准單**各自**進位）

1. **進位方向**：加班 1 分鐘、單位 30 分 → 進位為 0.5 小時。對員工有利，但與常見「未滿單位不計」政策相反——若這不是刻意決策，每筆加班平均多付近半個單位。方向本身是政策題，需要的是**確認並文件化**。
2. **逐筆膨脹**：同日兩筆核准單各 1h10m（單位 30 分）→ 各自進位 1.5h → 合計 3h；若先加總再進位（2h20m）→ 2.5h。多筆核准單場景系統性多付半單位×筆數。`resolveApprovedAttendanceOvertime` 對 raw 打卡時數與核准時數的比較也因兩邊各自進位而失真。

**修正方向**：政策確認進位方向（ceil／floor／round）做成設定（這個才值得是設定）；多筆核准單改為合計後進位一次。

**2026-07-17 再修正**：依出勤紀錄須記至分鐘及未滿一小時仍應換算的原則，`overtimeMinUnit` 僅作為「最低申請時數」，不得用來捨去已實際工作的分鐘。設定 60 分鐘時，17:00-17:59 仍未達申請門檻；17:00-19:31 通過門檻後須完整保存並認列為 2.52 小時。核准、薪資、補休、統計與警示皆以實際淨工時超過法定門檻的分鐘為準。

### OT5 時薪換算三軌

| 路徑 | 時薪來源 |
|------|----------|
| `overtime-calculator.ts:calculateHourlyWage` | 月薪 ÷ **240**，四捨五入，作為無薪資檔時薪的 fallback |
| `salary-utils.ts:calculateOvertimePayForRequest` | `getEffectiveSalary().hourlyRate`（薪資檔維護的時薪欄位） |
| `resignation-settlement` | `employee.hourlyRate`；未設定時月薪 ÷ 240 |

同一位員工的「一小時加班值多少錢」有三種算法。若薪資檔 hourlyRate 與 月薪÷240 不同步（調薪只改月薪沒改時薪），加班費與離職結算的基準互相矛盾。

**修正方向**：定一個權威換算（建議：薪資檔 hourlyRate 為準、以 月薪÷monthlyBasicHours 自動計算並在調薪時同步），其餘兩處引用同一函式。

**2026-07-12 已處理**：權威改定為薪資檔 `hourlyRate` 優先；沒有時才使用共用 `calculateMonthlySalaryHourlyRate(baseSalary)`（月薪 ÷ 240 後四捨五入）。`payroll-calculator` 改為把 resolved hourly wage 直接傳給加班費引擎，不再用 `baseSalary` 偷重算；離職結算預覽與正式結算同步改用同一權威。設定頁與 API 不再允許 `monthlyBasicHours` 覆寫時薪口徑。

---

## 低嚴重度

### OT6 `|| fallback` 使合法的 0 被靜默改寫

**位置**：`overtime-calculation/route.ts:131,134`（`Number.parseFloat(String(value)) || fallback`）

輸入 0 時 `0 || fallback` → fallback——費率欄位因下限 1 無實害；但 `clampHours` 若未來某欄位允許 0（如「假日加班上限 0＝禁止」），輸入 0 會被靜默改回原值且 UI 顯示儲存成功。慣用修法：`Number.isFinite(parsed) ? clamp(parsed) : fallback`。

**正面**：`overtimeMinUnit` 用白名單 `[1, 5, 15, 30, 60]` 驗證（L192）✓、`normalizeOvertimeUnitMinutes` 對 ≤0 有防呆 fallback 30（`overtime-hours.ts`）✓、設定寫入已接稽核（L216）✓——這條路由的防護意識高於平均。

**2026-07-12 已處理**：`monthlyBasicHours` 已改為不可由此設定頁覆寫；API 端保留既有值，不再把看似可調、實際不接線的數值寫回資料庫。

### OT7 設定顯示值與實算值不一致

設定預設 `1.34`／`1.67`，實算硬編碼 `4/3`（1.3333…）／`5/3`（1.6667…）——計算明細字串還印「× 4/3」。零消費之下無實害，但接線時要決定口徑：法定分數（精確）或兩位小數（近似、對員工微有利），別讓設定顯示與實付有 0.007 倍的暗差。

**2026-07-12 已處理**：設定頁不再把 1.34/1.67 作為可編輯設定顯示，改為唯讀顯示實際計算使用的法定分數倍率（4/3、5/3、8/3），避免顯示口徑與實算口徑不一致。

---

## 建議修復順序

目前稽核列出的 OT1–OT7 已處理；若未來要重新開放「費率可調」，需另開新需求並做完整法遵審核。

## 與系列文件的關聯

- OT1 與第五份「2FA required 存了沒人讀」、第十二份「Notification 表沒人讀」同一根因家族：**設定/資料寫入端完整、消費端缺席**——本系列第三次出現，建議把「新增設定欄位必附消費端」寫進團隊慣例。
- OT2 的雙引擎與第十三份 AR2 的「四套遲到判定」同構——同一業務規則多處實作必然分歧。加班費比遲到判定更敏感（直接是錢），優先級更高。
- `overtimeMinUnit` 是設定中**真正生效**的欄位，且已貫穿 records／today-summary／payroll——這條線的接線品質可以作為其他欄位接線的範本。
