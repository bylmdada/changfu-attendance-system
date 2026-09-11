# P2 優化項目實施計畫（第六份）

> 產出日期：2026-07-02
> 前置文件：[SYSTEM_OPTIMIZATION_ROADMAP.md](./SYSTEM_OPTIMIZATION_ROADMAP.md)、第二～五份實施文件
> 範圍：路線圖中約 30 項 P2，歸納為 7 個工作流（A–G）。
> 前提：P0/P1 多數已實作（備份、通知鈴鐺與 realtime 落地、BatchApproveBar v2、餘額警示、排班 dry-run 等），本文件以此為基礎，不重複已完成項。
> 執行狀態：G 技術債快贏已完成第一批（2026-07-02）：刪除兩個 0 行空殼檔，系統資訊版本改讀 `NEXT_PUBLIC_APP_VERSION`。

## 核實摘要（影響方案的三個事實）

| 路線圖原判斷 | 核實後現況 | 影響 |
|--------------|------------|------|
| 「統一導入一套圖表庫」 | **chart.js + react-chartjs-2 已在依賴**，且 `property-management/stats/PropertyTrendChart.tsx` 已有現成用法可仿 | 工作流 B 不需選型，直接沿用 |
| 「匯出邏輯散落各頁」 | `xlsx`（@e965/xlsx）已裝，`src/lib/csv.ts`、`src/lib/schedule-xlsx.ts` 已有部分共用邏輯 | 工作流 A 是「收斂」不是「新建」 |
| 空殼技術債 | `src/lib/system-settings-security.ts`、`src/lib/wifi-location.ts` 皆為 **0 行且無任何 import** | 直接刪除，零風險 |

## 工作流總覽

| 流 | 內容 | 預估 | 涵蓋路線圖項 |
|----|------|------|--------------|
| G | 技術債快贏 | 已完成 | 空殼檔、版本號 v2.1.0 |
| A | 共用匯出對話框 + 匯出整併 | 3–4 天 | 2.2-3、3.2-2、1.2-4、報表欄位自選 |
| B | 統計圖表與儀表板 | 3 天 | 2.2-4、薪資統計、儀表板刷新/鑽取、財產月統計 |
| C | 進階篩選面板 | 3 天 | 2.2-6、加班聯合篩選、請假逾期快篩 |
| D | 員工端 UX（兩批） | 6–7 天 | 1.1-7、1.3-2/3/4/5、1.4-1/3、1.5-2/3、1.6-3/4、1.7-7/8、1.8-6 |
| E | 設定治理與安全 | 3–4 天 | 4.1-2、4.3、4.4-4 |
| F | 管理模組小項 + 匯入框架 | 4–5 天 | 獎金/爭議/眷屬/財產、3.2-1 |

合計約 **22–27 天**。建議依上表順序執行（快贏先、共用件次之、頁面級收尾）。

---

## G. 技術債快贏（先做，半天）

1. 刪除 `src/lib/system-settings-security.ts`、`src/lib/wifi-location.ts`（0 行、無 import，已核實）。
2. 版本號：`system-settings/page.tsx:538` 的硬寫 `v2.1.0` 改讀 `process.env.NEXT_PUBLIC_APP_VERSION`，deploy 腳本以 `git describe --tags` 注入（若 P0 #7 已做 `APP_VERSION`，沿用同一來源）。
3. **不含**快速打卡整合（1.7-6）——它是功能開發不是清理，量體另估，列入待辦尾端。

已完成（2026-07-02）：空殼檔已刪除；系統設定頁版本改為 `NEXT_PUBLIC_APP_VERSION`，無值時顯示 `dev`。部署 build 以 `git describe --tags --always --dirty` 注入。

**驗證**：`npm run build` 通過；系統資訊頁顯示 git tag 版本。

---

## A. 共用匯出對話框 + 匯出整併

### 現況

- 各管理頁各寫一份 CSV/Excel 匯出（如 `overtime-management/page.tsx:188–210`），欄位固定、檔名無時間戳、無進度回饋。
- 基礎已有：`xlsx` 套件、`src/lib/csv.ts`、`src/lib/schedule-xlsx.ts`。

### 具體變更

1. `src/lib/export.ts`：統一 `exportRows(rows, columns, format, filenameBase)`——內部走既有 csv.ts / xlsx，檔名自動加 `-YYYYMMDD-HHmm`。
2. `src/components/ExportDialog.tsx`：欄位勾選（預設全選）、格式選 CSV/Excel、筆數提示；超過 1000 筆顯示「準備中」狀態（1.2-4 的進度回饋）。
3. 逐頁替換（每頁約半小時）：請假、加班、補打卡、調班、員工管理（順帶補上路線圖「員工無匯出」缺口）、報表頁（欄位自選即此元件）。
4. 匯出動作記 `logAudit`（`AuditAction.EXPORT` 已定義，P0 稽核同款接線）。

**跳過**：PDF 匯出、樞紐分析、自訂列序（勾選欄位已滿足 9 成需求）。

**驗證**：加班頁匯出勾 3 欄 → Excel 僅含 3 欄、檔名含時間戳；AuditLog 有 EXPORT 紀錄。

---

## B. 統計圖表與儀表板

### 現況

- chart.js 已裝，全站僅 `PropertyTrendChart.tsx` 一處使用——直接以它為範本。
- `payroll-statistics` 純表格；`dashboard-stats` 不自動刷新、卡片不可點。

### 具體變更

1. `payroll-statistics/page.tsx`：加兩張圖——月度薪資總額趨勢（Line）、部門人事成本對比（Bar），資料沿用頁面既有 API 回應，不動後端。
2. `dashboard-stats/page.tsx`：60 秒自動刷新（沿用 NotificationBell 的輪詢模式）；統計卡片加 `Link` 鑽取到對應管理頁（待審數 → approval-dashboard 等）。
3. 財產管理月度異動彙總（本月新增/報廢）：`property-management` 統計區加兩張數字卡 + 沿用 PropertyTrendChart 模式畫月趨勢。

**跳過**：PDF 簡報匯出（等有人真的要對外簡報再做）。

**驗證**：薪資統計頁圖表隨篩選條件變動；儀表板卡片點擊跳轉正確。

---

## C. 進階篩選面板

### 現況

- 各管理頁篩選條件固定且不可組合；請假無「逾期未審」快篩、加班無「部門+日期+狀態」聯合篩選。

### 具體變更

1. `src/components/FilterPanel.tsx`：宣告式欄位定義（select/dateRange/text），輸出 AND 組合的 query params；「儲存目前條件」存 localStorage（每頁最多 5 組）。`// ponytail: localStorage 即可，不做後端儲存`
2. 先接兩頁驗證模式：`overtime-management`（聯合篩選最痛）、`leave-management`（加「逾期未審」快捷 chip——申請日超過 N 天且 PENDING）。
3. 對應 API 確認支援組合條件（多數已支援單條件 where，組合為增量修改）。
4. 其餘頁面（員工、補打卡、審核儀表板）後續逐頁接入，不列入本批。

**驗證**：加班頁選「部門 A + 上月 + 待審核」→ 列表正確；儲存條件重整後可一鍵套用。

---

## D. 員工端 UX（兩批）

### D1：打卡與班表（3 天）

| 項 | 變更 | 檔案 |
|----|------|------|
| 今日考勤狀態卡片（1.1-7） | 今日記錄區加狀態標示：正常／遲到 X 分／早退，資料由 today-summary API 既有欄位判斷 | `attendance/page.tsx` |
| 班表格子 drawer（1.3-2） | 點月曆格開 drawer 顯示完整班別/時間/備註 | `my-schedule/page.tsx` |
| 匯出入口整合（1.3-3） | PDF/Excel/列印三入口收成一個下拉（沿用工作流 A 的 ExportDialog 風格） | 同上 |
| 確認歷史預載（1.3-4） | 預設載入近 6 個月確認狀態，未確認月份高亮 + 直達連結 | 同上 |
| 月份快取（1.3-5） | 已載入月份存 state Map，切回不重打 API | 同上 |

### D2：表單與顯示細節（3–4 天）

| 項 | 變更 |
|----|------|
| 附件上傳進度（1.6-3） | 上傳改 XHR 帶 onprogress，顯示百分比與大小限制文字（購買申請、扶養人共用一個小元件） |
| 編輯權限明示（1.6-4） | 待審核顯示「編輯」、已核准顯示鎖 icon + tooltip「已核准，無法修改」 |
| 薪資金額遮蔽（1.5-2） | 頁面右上「隱藏金額」toggle，開啟時金額以 `***` 顯示（純前端 state） |
| 薪資批次下載（1.5-3） | 月份範圍選擇 → 逐月呼叫既有 payslip-download 打包（前端 zip 或連續下載） |
| 補休紀錄排序/tooltip（1.4-3） | 表頭排序 + 交易類型/凍結 tooltip |
| 特休進度條（1.4-1） | 圓形圖改水平進度條 +「X/Y 天已使用」 |
| 數字格式化（1.8-6） | `src/lib/format.ts` 加 `formatCurrency`/`formatNumber`（`Intl.NumberFormat('zh-TW')`），薪資/獎金/報表頁替換 |
| 記住帳號警告（1.7-7） | checkbox 旁一行灰字「共用裝置請勿勾選」 |
| 逾時登出倒數（1.7-8） | session 到期前 60 秒顯示倒數 toast + 「延長」按鈕（呼叫既有 me/refresh 端點，實作時確認） |

**批內跳過**：補打卡審核進度預載（1.2-3）與表格橫捲提示（1.8-2）——效益低，列 P3 候補。

**驗證**：每項一條手動驗證（如遲到打卡 → 卡片顯示遲到分鐘數），實作時逐項附上。

---

## E. 設定治理與安全

### 具體變更

1. **設定匯出/匯入**（4.1-2 簡化版）：`api/system-settings/snapshot` GET 匯出全部設定為 JSON 下載、POST 匯入（管理員 + 二次確認 + 匯入前自動先下載一份現況作回滾依據）。**不做**版本表與 UI 歷史列表。`// ponytail: JSON 檔即快照，版本管理交給下載的檔案`
2. **常數設定化**（4.3）：僅做三個真的會調的——`OVERTIME_THRESHOLDS`（加班預警閾值）、寄件人名稱（併入既有 SMTP 設定頁的 fromName，模型已有欄位）、特休提醒天數（併入 leave-expiry 設定）。其餘維持常數。
3. **WebAuthn 金鑰管理**（4.4-4）：`personal-settings` 已有註冊/刪除；補管理員視角——安全設定頁列出各使用者憑證數量與撤銷按鈕（模型 `WebAuthnCredential` 已有，純呈現 + delete）。
4. **關鍵設定二級審核**（4.1-3）：**降級不做**——P0 設定稽核上線後已可追責 + 通知，二級審核流程成本高於當前風險，留待實際發生誤改事件再評估。

**驗證**：匯出 JSON → 改一設定 → 匯入 → 設定還原且 AuditLog 記錄匯入操作。

---

## F. 管理模組小項 + 匯入框架

### 具體變更

1. **通用匯入 helper**（3.2-1）：從 `annual-leaves/import` 抽出 `src/lib/import-xlsx.ts`（表頭對應、逐列驗證、錯誤回報格式），先套用到健保眷屬批量匯入（2.1 缺口），假日/部門匯入等有需求再接。
2. **獎金預算控制**：`BonusConfiguration` 加預算上限欄位（migration），配置頁顯示「已配置 / 預算」與超額紅字警示（只警示不擋，與餘額警示同哲學）。
3. **薪資爭議分類**：`PayrollDispute` 加 category 欄位（計算錯誤/漏項/其他），列表加分類篩選；結案時發通知給員工（通知底座已就緒，3 行接線）；統計卡顯示平均處理天數。
4. **健保眷屬頁分頁籤**：「眷屬清冊」與「申請審核」拆兩個 tab（純前端重排）。
5. **財產掃描進度**：掃描模式顯示「本場地已掃 X / 共 Y 筆」（資料已在前端 state）。

**驗證**：眷屬 Excel 匯入含一列錯誤資料 → 回報第幾列什麼錯、其餘正常入庫；獎金配置超預算 → 紅字警示。

---

## 實施順序與建議

```
G（半天快贏）→ A（匯出，最多頁受益）→ B（圖表）→ D1 → C（篩選）→ F → D2 → E
```

- A/B/C 是共用件，先做讓後面頁面級工作直接取用。
- E-4（二級審核）明確建議不做；D 批內兩項降 P3——P2 的原則同樣是「有明確效益才動工」。
- 快速打卡整合（1.7-6）為獨立功能開發，建議完成上述後單獨開一份評估（涉及 login 頁重構）。

## 系列文件狀態

| 份 | 文件 | 狀態 |
|----|------|------|
| 1 | `SYSTEM_OPTIMIZATION_ROADMAP.md` | 總覽（隨核實持續更新） |
| 2 | `P0_IMPLEMENTATION_PLAN.md` | 備份已完成，餘執行中 |
| 3 | `P1_SHARED_COMPONENTS_DESIGN.md` | 鈴鐺/批次元件/realtime 落地/PAYROLL_READY 已完成 |
| 4 | `P1_ADMIN_MODULES_PLAN.md` | 餘額警示、排班覆蓋確認已完成 |
| 5 | `P1_CLEANUP_CHECKLIST.md` | 通知整併已完成（第三份第二批），餘執行中 |
| 6 | 本文件 | P2 七個工作流 |

P3 項目（i18n、離線打卡、ARIA 全面改善、OpenAPI、第三方通知渠道）維持「有明確業務需求再展開」，不預先排程。
